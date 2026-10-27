// Android computer adapter: one stdio MCP server the phone harness spawns,
// giving OpenMausBot agents a real execution environment on the device.
//
// Upstream mounts every "computer" as a stdio MCP descriptor (local-computer,
// container, VPS); this is Android's. It is seeded host-side into config.json
// mcpServers (android-seed.ts) so the ordinary turn pipeline mounts it:
// openai-compat engines see its tools as native function tools, and every
// call rides the existing permission-card flow (chat-tool-approval.ts).
//
// Tools (Phase 4A–4D):
//   workspace_*  — a sandboxed filesystem under AC_WORKSPACE
//   run_command  — allowlisted toybox applets, argv-spawned, no shell
//   run_shell    — the full terminal: one `sh -c` pass, pipes/redirects,
//                  any binary on PATH, no path boundary (the person's choice)
//   http_fetch   — genuine network requests, SSRF-guarded (android-net-guard)
//   web_search   — real web search (DuckDuckGo HTML Lite), live internet
//   resource_*   — internet resource acquisition (android-resources.ts):
//                  inspect/fetch/download URLs, PDF text extraction,
//                  HTML link/image extraction, artifact manifest
//
// Everything returns bounded text; nothing reads or logs credentials (the
// proxy's env is only ever the workspace path and a command PATH allowlist).
import { spawn } from "node:child_process";
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync,
  readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMAND_PATH, MAX_FILE_BYTES, MAX_LIST_ENTRIES, MAX_OUTPUT_BYTES, MAX_READ_BYTES,
  SandboxError, SYSTEM_BIN, assertWritableTarget, prepareCommand, resolveInside,
} from "./android-computer-sandbox.ts";
import {
  NetworkPolicyError, guardedRequest, validateUrl,
} from "./android-net-guard.ts";
import { RESOURCE_TOOLS } from "./android-resources.ts";
import { placeAddonsIn } from "./android-native-addons.ts";
import { APP_BUILDER_TOOLS, setProjectManager } from "./app-builder/app-builder-tools.ts";
import { DEVICE_CAPABILITY_TOOLS } from "./capabilities/capability-registry.ts";
import { COMPUTER_AGENT_TOOLS } from "./computer-agent/agent-tools.ts";
import { ProjectManager } from "./app-builder/project-manager.ts";
import { checkToolPermission, loadDiskPermissions } from "./permission-policy.ts";

const isMainScript = Boolean(
  process.argv[1] &&
  (process.argv[1].replace(/\\/g, "/").endsWith("android-computer.ts") ||
   process.argv[1].replace(/\\/g, "/").endsWith("android-computer.js"))
);

const WORKSPACE = process.env.AC_WORKSPACE ?? "";
if (!WORKSPACE && isMainScript) {
  process.stderr.write("android-computer: AC_WORKSPACE is not set\n");
  process.exit(2);
}
if (WORKSPACE) {
  mkdirSync(WORKSPACE, { recursive: true });
  mkdirSync(join(WORKSPACE, ".tmp"), { recursive: true });
  const PROJECTS_DIR = process.env.OMB_PROJECTS_DIR || (process.env.OMB_DATA_DIR ? join(process.env.OMB_DATA_DIR, "projects") : join(WORKSPACE, "projects"));
  setProjectManager(new ProjectManager(PROJECTS_DIR));
}

// ── Embedded Node runtime for the bot terminal ─────────────────────────────
// Android denies execve of anything under app data (noexec mount), except
// the APK's native library dir. The harness runs this very adapter with the
// embedded node binary from that dir, so process.execPath IS an exec-allowed
// node. Exposing it to the bot shell:

// ── Official Roadmap Phase 35: Android-as-Computer (mobot_54_phases_prompt.md:1897-1948) ──
export type AndroidGestureType = "tap" | "double_tap" | "long_press" | "type" | "swipe" | "press_key";

export interface AndroidGestureAction {
  gesture: AndroidGestureType;
  coordinates?: { x: number; y: number };
  swipeVector?: { startX: number; startY: number; endX: number; endY: number; durationMs: number };
  inputText?: string;
  keyCode?: number; // e.g. KeyEvent.KEYCODE_BACK, KEYCODE_HOME
  targetNodeId?: string;
}

export interface AndroidUiSemanticNode {
  nodeId: string;
  packageName: string;
  className: string;
  text?: string;
  contentDescription?: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  isClickable: boolean;
  isEditable: boolean;
  isEnabled: boolean;
}

export const RESTRICTED_SYSTEM_PACKAGES = [
  "com.android.permissioncontroller",
  "com.google.android.permissioncontroller",
  "com.android.packageinstaller",
  "com.google.android.packageinstaller",
  "com.samsung.android.packageinstaller",
  "com.samsung.android.permissioncontroller",
] as const;

/**
 * Validate that an Android gesture action does not target restricted system permission dialogues.
 * Invariant: Accessibility actions must never interact with system permission dialogues attempting to silently grant dangerous permissions.
 */
export function validateGestureActionSafety(
  _action: AndroidGestureAction,
  activePackage?: string
): { safe: boolean; reason?: string } {
  if (activePackage) {
    const pkgLower = activePackage.toLowerCase();
    if (RESTRICTED_SYSTEM_PACKAGES.some((p) => pkgLower.startsWith(p))) {
      return {
        safe: false,
        reason: `ERR_SECURITY_RESTRICTED: Accessibility actions are prohibited on system permission dialog '${activePackage}' to prevent silent permission granting.`,
      };
    }
  }
  return { safe: true };
}

/**
 * Parse raw accessibility hierarchy response into normalized AndroidUiSemanticNode array.
 */
export function parseAndroidUiHierarchy(raw: unknown): AndroidUiSemanticNode[] {
  if (!raw || typeof raw !== "object") return [];
  const nodes = Array.isArray((raw as any).nodes) ? (raw as any).nodes : [];
  return nodes.map((n: any, idx: number) => {
    const b = n.boundsObj || (Array.isArray(n.bounds) && n.bounds.length >= 4 ? {
      left: n.bounds[0],
      top: n.bounds[1],
      right: n.bounds[2],
      bottom: n.bounds[3],
    } : { left: 0, top: 0, right: 0, bottom: 0 });

    return {
      nodeId: typeof n.nodeId === "string" ? n.nodeId : `node_${b.left}_${b.top}_${b.right}_${b.bottom}_${idx}`,
      packageName: typeof n.package === "string" ? n.package : (typeof n.packageName === "string" ? n.packageName : ""),
      className: typeof n.className === "string" ? n.className : "",
      text: typeof n.text === "string" && n.text.trim() ? n.text : undefined,
      contentDescription: typeof n.description === "string" && n.description.trim() ? n.description : (typeof n.contentDescription === "string" ? n.contentDescription : undefined),
      bounds: b,
      isClickable: Boolean(n.clickable ?? n.isClickable),
      isEditable: Boolean(n.editable ?? n.isEditable),
      isEnabled: Boolean(n.isEnabled ?? true),
    };
  });
}

/**
 * Serialize an AndroidGestureAction into driver-compatible request payload.
 */
export function serializeAndroidGesture(action: AndroidGestureAction): Record<string, unknown> {
  const base: Record<string, unknown> = { gesture: action.gesture };
  if (action.coordinates) {
    base.x = action.coordinates.x;
    base.y = action.coordinates.y;
  }
  if (action.swipeVector) {
    base.swipeVector = action.swipeVector;
  }
  if (action.inputText) {
    base.text = action.inputText;
  }
  if (action.targetNodeId) {
    base.targetNodeId = action.targetNodeId;
  }
  if (typeof action.keyCode === "number") {
    const keyMap: Record<number, string> = {
      4: "back",
      3: "home",
      187: "recents",
      83: "notifications",
    };
    base.key = keyMap[action.keyCode] || String(action.keyCode);
  }
  return base;
}
//   node — a symlink in <workspace>/.omb-bin pointing at process.execPath;
//          exec() follows the symlink to the exec-allowed target (verified
//          on device; the symlink file itself may live on noexec app data).
//   npm  — a symlink to the APK's native launcher (libombexec.so), which
//          execs the embedded runtime on the npm CLI bundled beside this file
//          (server.zip ships it as npm/bin/npm-cli.js — data to node, so the
//          noexec mount never matters). A build without the launcher falls
//          back to a script plus a shell function, which is a difference in
//          reach, never in what `npm` means.
//   npx  — the same launcher, pointed at android-npx-shim.js (beside this
//          file): npm's own npx execs package .bin launchers, which the noexec
//          mount denies; the shim resolves the package's bin JS file and runs
//          it with the embedded node instead. Native binaries are refused with
//          a clear message rather than a confusing ENOEXEC.
const NODE_BIN = process.execPath;
const NATIVE_LIB_DIR = dirname(NODE_BIN);
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const NPM_CLI = process.env.OMB_NPM_CLI || join(SERVER_DIR, "npm", "bin", "npm-cli.js");
const NPX_SHIM = process.env.OMB_NPX_SHIM || join(SERVER_DIR, "android-npx-shim.js");
const BOT_BIN_DIR = join(WORKSPACE, ".omb-bin");
const NPM_PREFIX = join(WORKSPACE, ".npm-prefix");
// The APK ships a second native executable beside the runtime (libombexec.so,
// built from android/app/src/main/jni/ombexec.c). It exists for exactly one
// reason: a symlink into the native library directory is allowed to be
// executed, and a file in app data is not — so `node` has always worked as a
// symlink and npm/npx never could, because they are not ELF files of their own.
// The launcher closes that gap: it takes the name it was invoked as, resolves
// it to the real CLI, and execs the embedded runtime on it. OMB_EXEC_LAUNCHER
// exists so the suite can point at a host build of the same source.
const EXEC_LAUNCHER = process.env.OMB_EXEC_LAUNCHER || join(NATIVE_LIB_DIR, "libombexec.so");

/** Create (or refresh) the exec-allowed `node` symlink. Returns true when
 *  `node` will resolve on PATH. Reinstalls of the app change the native lib
 *  directory hash, so an existing symlink pointing at a stale target is
 *  replaced. */
function ensureNodeSymlink(): boolean {
  return ensureSymlink("node", NODE_BIN);
}

/** Publish `name` as a symlink to [target] in the bot bin directory. */
function ensureSymlink(name: string, target: string): boolean {
  try {
    mkdirSync(BOT_BIN_DIR, { recursive: true });
    const link = join(BOT_BIN_DIR, name);
    const st = lstatSync(link, { throwIfNoEntry: false });
    if (st && (!st.isSymbolicLink() || readlinkSync(link) !== target)) {
      rmSync(link, { force: true });
    }
    if (!existsSync(link)) symlinkSync(target, link);
    return true;
  } catch {
    return false;
  }
}

/** True when this build ships the native launcher npm/npx can be a symlink
 *  to. False on a build that does not, which falls back to the shell wrappers
 *  below — a difference in reach (a subprocess versus only a shell), never in
 *  what the name means. */
function hasNativeLauncher(): boolean {
  try {
    return existsSync(EXEC_LAUNCHER) && statSync(EXEC_LAUNCHER).isFile();
  } catch {
    return false;
  }
}

/** The runtime commands the bot shell exposes as REAL executables, not shell
 * functions. A function only exists inside the shell that defined it: `nohup
 * npx …`, `sh -c 'npx …'`, `xargs`, an npm script's PATH lookup, or any child
 * process asks the kernel for a FILE named npx. Android does allow exec of a
 * shebang script in app data (verified on device: a 0755 script with
 * `#!/system/bin/sh` runs), so each name is published as a tiny script that
 * execs the embedded node against the real CLI. Rewritten only when its text
 * changes, and always with the current absolute paths, because an app
 * reinstall moves the native library directory under `node`. */
function publishRuntimeBin(name: string, script: string): boolean {
  try {
    mkdirSync(BOT_BIN_DIR, { recursive: true });
    const path = join(BOT_BIN_DIR, name);
    // A missing file is the normal first case, not a failure: read it apart
    // from the write so "not published yet" and "could not publish" differ.
    let current: string | null = null;
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = null;
    }
    if (current !== script) {
      writeFileSync(path, script, { mode: 0o755 });
      chmodSync(path, 0o755);
    }
    return true;
  } catch {
    return false;
  }
}

/** Publish node, npm and npx so a person's shell, a spawned subprocess and a
 * background process all resolve the SAME runtime. Returns the names that
 * will resolve on PATH. */
function publishRuntimeBins(): string[] {
  const published: string[] = [];
  if (!ensureNodeSymlink()) return published;
  published.push("node");
  // Two publication strategies, same names, same behavior:
  //
  //   * this build ships libombexec.so → npm/npx are SYMLINKS to it, exactly
  //     like node. A subprocess, a background job, an npm script and a terminal
  //     session all resolve them, because the kernel resolves the symlink to a
  //     file in the native library directory, which is exec-allowed.
  //   * a build without it → tiny scripts, which are what a shell can run.
  //     The scripts cannot be exec'd by a subprocess: on device, Android
  //     refuses execve of app-data files from the app's own domain (a file here
  //     runs when a shell READS it, and answers EACCES to `nohup npx` or
  //     spawnSync). Measured on the phone, both ways.
  //
  // The first two bytes of a script are load-bearing: without "#!" the kernel
  // has no interpreter for the file, execve answers ENOEXEC, and the caller's
  // shell falls back to reading the script's own first line as a command —
  // which on device opened an interactive shell and hung the call.
  const sh = `#!${SYSTEM_BIN}/sh`;
  // `exec`, so the signal a caller sends reaches node itself and no wrapper
  // process is left holding a pid nobody can kill.
  const launcher = hasNativeLauncher();
  if (existsSync(NPM_CLI)) {
    const ok = launcher
      ? ensureSymlink("npm", EXEC_LAUNCHER)
      : publishRuntimeBin("npm", `${sh}\nexec "${NODE_BIN}" "${NPM_CLI}" "$@"\n`);
    if (ok) published.push("npm");
  }
  if (existsSync(NPX_SHIM)) {
    const ok = launcher
      ? ensureSymlink("npx", EXEC_LAUNCHER)
      : publishRuntimeBin("npx", `${sh}\nexec "${NODE_BIN}" "${NPX_SHIM}" "$@"\n`);
    if (ok) published.push("npx");
  }
  return published;
}

/**
 * Place the APK's prebuilt native addons into every package tree the bot can
 * launch a CLI from. Both addons (node-datachannel for WebRTC, utp-native for
 * uTP) are compiled by scripts/android-net/build-native-addons.mjs and shipped
 * inside this bundle, because Android cannot compile them on the phone: npm
 * installs with --ignore-scripts, and a build step would have nothing to exec.
 *
 * This runs once, at adapter startup, so a package installed before this build
 * (or installed by npm directly rather than through the npx shim) still finds
 * its addon. The npx shim does the same thing for its own prefix on every run,
 * which is what makes it stick for a fresh install.
 *
 * Best effort, and deliberately silent about packages that are not installed:
 * the libraries themselves probe for their addon, so nothing here can claim a
 * capability that is not really there.
 */
function placeNativeAddons(): void {
  const roots = [join(NPM_PREFIX, "node_modules"), join(WORKSPACE, "node_modules")];
  // The bot shell's HOME is the workspace, so its npx installs land under
  // <workspace>/.npm/_npx-shim; a process launched with the app's own HOME
  // lands under that one. Both are real trees on the phone.
  for (const home of [WORKSPACE, process.env.HOME]) {
    if (!home) continue;
    const shimRoot = join(home, ".npm", "_npx-shim");
    try {
      for (const entry of readdirSync(shimRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) roots.push(join(shimRoot, entry.name, "node_modules"));
      }
    } catch {
      // No shim tree yet is the normal first case, not a failure.
    }
  }
  for (const root of roots) {
    const outcome = placeAddonsIn(root, {
      onPlace: (what) => process.stderr.write(`android-computer: native addon ${what}\n`),
    });
    for (const refusal of outcome.refused) {
      process.stderr.write(`android-computer: native addon not placed — ${refusal}\n`);
    }
  }
}

placeNativeAddons();

/** Clean shell env for the bot terminal: no credentials from this process,
 *  plus what node/npm need on Android (library path for the embedded
 *  runtime, install prefix inside the workspace, and the npx shim wiring).
 *  Env overrides (OMB_NPM_CLI/OMB_NPX_SHIM) exist for tests. */
function shellEnv(): Record<string, string> {
  const published = publishRuntimeBins();
  const hasNode = published.includes("node");
  return {
    PATH: [hasNode ? BOT_BIN_DIR : "", COMMAND_PATH, process.env.PATH].filter(Boolean).join(":"),
    HOME: WORKSPACE,
    TMPDIR: join(WORKSPACE, ".tmp"),
    LANG: "C.UTF-8",
    SHELL: `${SYSTEM_BIN}/sh`,
    ANDROID_ROOT: "/system",
    ANDROID_DATA: "/data",
    LD_LIBRARY_PATH: NATIVE_LIB_DIR,
    NPM_CONFIG_PREFIX: NPM_PREFIX,
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    OMB_NPM_CLI: NPM_CLI,
    OMB_NPX_SHIM: NPX_SHIM,
  };
}

/** Prepended to every run_shell command: defines this shell's npm()/npx()
 *  functions over the published wrappers. Functions are what a shell can run
 *  here — Android denies the app's own domain exec of an app-data file, so a
 *  subprocess must reach the same shim through $OMB_NPX_SHIM instead. */
function shellPrelude(): string {
  const lines = ["# OpenMausBot terminal runtime: node is on PATH; npm/npx run here."];
  if (ensureNodeSymlink()) {
    const node = join(BOT_BIN_DIR, "node");
    if (existsSync(NPM_CLI)) lines.push(`npm() { "${node}" "${NPM_CLI}" "$@"; }`);
    if (existsSync(NPX_SHIM)) lines.push(`npx() { "${node}" "${NPX_SHIM}" "$@"; }`);
  }
  return lines.join("\n");
}

// ── MCP over stdio (newline-delimited JSON-RPC, same envelope the harness
// speaks; protocolVersion 2024-11-05 matches chat-mcp-tools.ts) ─────────────
type RpcMessage = { id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: unknown };

const FRAME_BYTES = 2 * 1024 * 1024;
const MAX_FRAMES = 50_000;
let frames = 0;
let buffer = "";

function writeFrame(frame: unknown): void {
  const line = JSON.stringify(frame) + "\n";
  if (Buffer.byteLength(line) > FRAME_BYTES) throw new Error("frame too large");
  process.stdout.write(line);
}

function reply(id: number | string, result: unknown): void {
  writeFrame({ jsonrpc: "2.0", id, result });
}

function replyError(id: number | string, message: string, code = -32603): void {
  writeFrame({ jsonrpc: "2.0", id, error: { code, message } });
}

// ── Bounded text helpers ────────────────────────────────────────────────────
function bounded(text: string, limit = MAX_OUTPUT_BYTES, marker = " [output truncated]"): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  let end = limit;
  // Back up to a code-point boundary, then also back off a combining
  // sequence head: cutting between a base character and its combining marks
  // leaves a bare "one continue byte" replacement char that breaks a
  // downstream JSON.stringify consumer. (256KB of zero bytes is ASCII-safe;
  // this keeps the cap honest for arbitrary binary-as-utf8 output too.)
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  if (end > 0 && (bytes[end] & 0xe0) === 0xc0) end -= 1;
  return bytes.subarray(0, end).toString("utf8") + marker;
}

// ── Tool implementations ────────────────────────────────────────────────────
function toolError(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

// Missing-path policy for the workspace_* tools: a read of something that is
// not there is an ordinary condition, not a crash. These tools answer a
// structured `ok:false` instead of letting a raw ENOENT become the chat's
// "android_computer_workspace_stat" error row. The hostile-name case
// (SandboxError) stays its own refusal, unchanged.
function missingPath(rel: string): { ok: false; error: string } {
  return toolError(`no file or directory named "${rel}" exists in the workspace yet`);
}

function entryInfo(path: string): Record<string, unknown> {
  const info = statSync(path);
  return {
    size: info.size,
    isDirectory: info.isDirectory(),
    isFile: info.isFile(),
    modifiedAtMs: Math.round(info.mtimeMs),
    mode: info.mode & 0o777,
  };
}

function workspaceList(args: Record<string, unknown>): unknown {
  const rel = typeof args.path === "string" && args.path ? args.path : ".";
  let target: string;
  let info;
  try {
    target = resolveInside(WORKSPACE, rel);
    info = lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missingPath(rel);
    if (error instanceof SandboxError) return toolError(error.message);
    throw error;
  }
  if (!info.isDirectory()) return toolError("not a directory");
  const entries = readdirSync(target, { withFileTypes: true });
  if (entries.length > MAX_LIST_ENTRIES) return toolError(`directory has more than ${MAX_LIST_ENTRIES} entries`);
  const rows = entries.slice(0, MAX_LIST_ENTRIES).map((entry) => {
    let size = null;
    let isDirectory = entry.isDirectory();
    try {
      size = statSync(join(target, entry.name)).size;
    } catch {
      // a racing delete is fine; the name still lists
    }
    return { name: entry.name, type: isDirectory ? "directory" : entry.isFile() ? "file" : "other", size };
  });
  return { ok: true, path: rel, entries: rows, count: rows.length };
}

function workspaceRead(args: Record<string, unknown>): unknown {
  if (typeof args.path !== "string") return toolError("path is required");
  let target: string;
  let info;
  try {
    target = resolveInside(WORKSPACE, args.path);
    info = statSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missingPath(args.path);
    if (error instanceof SandboxError) return toolError(error.message);
    throw error;
  }
  if (info.isDirectory()) return toolError("path is a directory; use workspace_list");
  if (info.size > MAX_READ_BYTES) {
    return toolError(`file is ${info.size} bytes; workspace_read is capped at ${MAX_READ_BYTES} bytes — read a slice via run_command (head/tail) instead`);
  }
  const encoding = args.encoding === "base64" ? "base64" : "utf8";
  const text = readFileSync(target, encoding as "utf8" | "base64");
  return { ok: true, path: args.path, encoding, size: info.size, text: bounded(text, MAX_OUTPUT_BYTES) };
}

function workspaceWrite(args: Record<string, unknown>): unknown {
  if (typeof args.path !== "string") return toolError("path is required");
  const content = typeof args.content === "string" ? args.content : "";
  const encoding = args.encoding === "base64" ? "base64" : "utf8";
  const bytes = encoding === "base64"
    ? Buffer.from(content, "base64")
    : Buffer.from(content, "utf8");
  if (bytes.length > MAX_FILE_BYTES) return toolError(`content exceeds ${MAX_FILE_BYTES} bytes`);
  const target = resolveInside(WORKSPACE, args.path);
  assertWritableTarget(target);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return { ok: true, path: args.path, bytesWritten: bytes.length };
}

function workspaceAppend(args: Record<string, unknown>): unknown {
  if (typeof args.path !== "string") return toolError("path is required");
  const content = typeof args.content === "string" ? args.content : "";
  const encoding = args.encoding === "base64" ? "base64" : "utf8";
  const incoming = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
  const target = resolveInside(WORKSPACE, args.path);
  assertWritableTarget(target);
  let existing = Buffer.alloc(0);
  try {
    const size = statSync(target).size;
    if (size > MAX_FILE_BYTES) return toolError(`file already exceeds ${MAX_FILE_BYTES} bytes`);
    existing = readFileSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing.length + incoming.length > MAX_FILE_BYTES) {
    return toolError(`append would exceed ${MAX_FILE_BYTES} bytes`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.concat([existing, incoming]));
  return { ok: true, path: args.path, bytesWritten: incoming.length, sizeAfter: existing.length + incoming.length };
}

function workspaceMkdir(args: Record<string, unknown>): unknown {
  if (typeof args.path !== "string") return toolError("path is required");
  const recursive = args.recursive !== false;
  const target = resolveInside(WORKSPACE, args.path);
  mkdirSync(target, { recursive });
  return { ok: true, path: args.path };
}

function workspaceMove(args: Record<string, unknown>): unknown {
  if (typeof args.from !== "string" || typeof args.to !== "string") return toolError("from and to are required");
  let from: string;
  let to: string;
  try {
    from = resolveInside(WORKSPACE, args.from);
    to = resolveInside(WORKSPACE, args.to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missingPath(args.from);
    if (error instanceof SandboxError) return toolError(error.message);
    throw error;
  }
  if (!existsSync(from)) return missingPath(args.from);
  assertWritableTarget(to);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  return { ok: true, from: args.from, to: args.to };
}

function workspaceCopy(args: Record<string, unknown>): unknown {
  if (typeof args.from !== "string" || typeof args.to !== "string") return toolError("from and to are required");
  let from: string;
  let to: string;
  try {
    from = resolveInside(WORKSPACE, args.from);
    to = resolveInside(WORKSPACE, args.to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missingPath(args.from);
    if (error instanceof SandboxError) return toolError(error.message);
    throw error;
  }
  if (!existsSync(from)) return missingPath(args.from);
  assertWritableTarget(to);
  const info = statSync(from);
  if (info.isDirectory()) {
    return toolError("copying directories is not supported; list and copy files individually");
  }
  if (info.size > MAX_FILE_BYTES) return toolError(`source exceeds ${MAX_FILE_BYTES} bytes`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return { ok: true, from: args.from, to: args.to, bytes: info.size };
}

function workspaceDelete(args: Record<string, unknown>): unknown {
  if (typeof args.path !== "string") return toolError("path is required");
  if (args.path === "." || args.path === "/" || args.path === "") {
    return toolError("refusing to delete the workspace root; delete entries instead");
  }
  const target = resolveInside(WORKSPACE, args.path);
  const relative = target.slice(WORKSPACE.length).replace(/^\/+/, "");
  if (!relative) return toolError("refusing to delete the workspace root; delete entries instead");
  const recursive = args.recursive === true;
  let info;
  try {
    info = lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missingPath(args.path);
    throw error;
  }
  if (info.isDirectory() && !recursive) return toolError("path is a directory; pass recursive=true");
  rmSync(target, { recursive, force: false });
  return { ok: true, deleted: args.path };
}

function workspaceStat(args: Record<string, unknown>): unknown {
  if (typeof args.path !== "string") return toolError("path is required");
  let target: string;
  try {
    target = resolveInside(WORKSPACE, args.path);
    return { ok: true, path: args.path, ...entryInfo(target) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missingPath(args.path);
    if (error instanceof SandboxError) return toolError(error.message);
    throw error;
  }
}

function workspaceExists(args: Record<string, unknown>): unknown {
  if (typeof args.path !== "string") return toolError("path is required");
  try {
    const target = resolveInside(WORKSPACE, args.path);
    return { ok: true, path: args.path, exists: existsSync(target) };
  } catch (error) {
    if (error instanceof SandboxError) return toolError(error.message);
    throw error;
  }
}

function runCommand(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  let prepared;
  try {
    prepared = prepareCommand(WORKSPACE, args.command as string, args.args, args.timeoutMs);
  } catch (error) {
    if (error instanceof SandboxError) return Promise.resolve(toolError(error.message));
    throw error;
  }
  return new Promise((resolve) => {
    const child = spawn(prepared.file, prepared.args, {
      cwd: WORKSPACE,
      env: prepared.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }, prepared.timeoutMs);
    const bail = () => {
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    };
    signal.addEventListener("abort", bail, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) + chunk.length <= MAX_OUTPUT_BYTES * 4) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) + chunk.length <= MAX_OUTPUT_BYTES * 2) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(toolError(`could not execute ${args.command}: ${error.message}`));
    });
    child.on("close", (code, signalName) => {
      clearTimeout(timer);
      resolve({
        ok: !killed && code === 0,
        exitCode: code,
        ...(killed ? { timedOut: true } : {}),
        ...(signalName && !killed ? { killedBy: signalName } : {}),
        stdout: bounded(stdout),
        ...(stderr ? { stderr: bounded(stderr, 64 * 1024) } : {}),
      });
    });
  });
}

const MAX_SHELL_CHARS = 8_000;
const SHELL_TIMEOUT_MS_DEFAULT = 30_000;
const SHELL_TIMEOUT_MS_MAX = 60_000;

/** The full terminal, as asked for: one `sh -c` pass with a real shell —
 * pipes, redirects, subshells, any binary on PATH, and absolute paths
 * anywhere this app can reach (/sdcard, /data/data/…) — with no allowlist
 * and no workspace boundary on paths. The env is a clean shell env rather
 * than the process env: this server's environment can carry harness
 * credentials, and handing those to arbitrary commands is not "access",
 * it is a leak. Bounds (timeout, output caps, abort) are transport limits,
 * exactly the ones run_command has — not a sandbox. */
function runShell(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const command = typeof args.command === "string" ? args.command : "";
  if (!command.trim()) return Promise.resolve(toolError("command is required"));
  if (command.includes("\0")) return Promise.resolve(toolError("command must not contain NUL characters"));
  if (command.length > MAX_SHELL_CHARS) return Promise.resolve(toolError(`command exceeds ${MAX_SHELL_CHARS} characters`));
  let timeoutMs = SHELL_TIMEOUT_MS_DEFAULT;
  if (args.timeoutMs !== undefined && args.timeoutMs !== null) {
    if (typeof args.timeoutMs !== "number" || !Number.isSafeInteger(args.timeoutMs) || args.timeoutMs < 100) {
      return Promise.resolve(toolError("timeoutMs must be an integer >= 100"));
    }
    if (args.timeoutMs > SHELL_TIMEOUT_MS_MAX) {
      return Promise.resolve(toolError(`timeoutMs exceeds the ${SHELL_TIMEOUT_MS_MAX / 1000}s limit`));
    }
    timeoutMs = args.timeoutMs;
  }
  return new Promise((resolve) => {
    const child = spawn(`${SYSTEM_BIN}/sh`, ["-c", `${shellPrelude()}\n${command}`], {
      cwd: WORKSPACE,
      env: shellEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }, timeoutMs);
    const bail = () => {
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    };
    signal.addEventListener("abort", bail, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stdout) + chunk.length <= MAX_OUTPUT_BYTES * 4) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) + chunk.length <= MAX_OUTPUT_BYTES * 2) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(toolError(`could not start the shell: ${error.message}`));
    });
    child.on("close", (code, signalName) => {
      clearTimeout(timer);
      resolve({
        ok: !killed && code === 0,
        exitCode: code,
        ...(killed ? { timedOut: true } : {}),
        ...(signalName && !killed ? { killedBy: signalName } : {}),
        stdout: bounded(stdout),
        ...(stderr ? { stderr: bounded(stderr, 64 * 1024) } : {}),
      });
    });
  });
}

const FETCH_MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS_DEFAULT = 15_000;
const FETCH_TIMEOUT_MS_MAX = 45_000;

async function httpFetch(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) return toolError("url is required");
  // Policy gate: the guard validates the URL, every redirect hop, and the
  // resolved IP addresses (DNS is resolved by us and the connection is pinned
  // to the validated answer) — see android-net-guard.ts.
  let parsed: URL;
  try {
    parsed = validateUrl(url);
  } catch (error) {
    return toolError(error instanceof NetworkPolicyError ? error.message : "url is not a valid absolute URL");
  }
  const method = typeof args.method === "string" ? args.method.toUpperCase() : "GET";
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return toolError(`method not allowed: ${method}`);
  }
  const headers: Record<string, string> = {};
  if (args.headers !== undefined) {
    if (typeof args.headers !== "object" || args.headers === null || Array.isArray(args.headers)) {
      return toolError("headers must be an object");
    }
    for (const [name, value] of Object.entries(args.headers as Record<string, unknown>)) {
      if (typeof value !== "string") return toolError("header values must be strings");
      if (/^(authorization|cookie|proxy-authorization)$/i.test(name)) {
        return toolError(`the ${name} header is not allowed; the adapter carries no credentials`);
      }
      headers[name] = value.slice(0, 4_096);
    }
  }
  let requestBody: string | undefined;
  if (args.body !== undefined && args.body !== null) {
    if (typeof args.body !== "string") return toolError("body must be a string");
    if (args.body.length > 1024 * 1024) return toolError("body exceeds 1MB");
    requestBody = args.body;
    if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/json";
    }
  }
  let timeoutMs = FETCH_TIMEOUT_MS_DEFAULT;
  if (args.timeoutMs !== undefined) {
    if (typeof args.timeoutMs !== "number" || !Number.isSafeInteger(args.timeoutMs) || args.timeoutMs < 250) {
      return toolError("timeoutMs must be an integer >= 250");
    }
    if (args.timeoutMs > FETCH_TIMEOUT_MS_MAX) return toolError(`timeoutMs exceeds the ${FETCH_TIMEOUT_MS_MAX / 1000}s limit`);
    timeoutMs = args.timeoutMs;
  }
  try {
    const { meta, finalUrl, body, truncated } = await guardedRequest(parsed, {
      method,
      headers,
      ...(requestBody !== undefined && method !== "GET" && method !== "HEAD" ? { body: Buffer.from(requestBody, "utf8") } : {}),
      maxBodyBytes: FETCH_MAX_BYTES,
      timeoutMs,
      signal,
      onOversize: "truncate",
    });
    const contentType = meta.contentType;
    const showText = truncated || contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml") || contentType === "";
    const text = showText
      ? bounded(body.toString("utf8"), MAX_OUTPUT_BYTES)
      : `<${body.length} bytes of ${contentType || "unknown type"}; not shown>`;

    return {
      ok: meta.status >= 200 && meta.status < 300,
      status: meta.status,
      statusText: meta.statusText,
      finalUrl: finalUrl.href,
      headers: meta.headers,
      size: body.length,
      ...(truncated ? { truncated: true } : {}),
      body: text,
    };
  } catch (error) {
    if (signal.aborted) return toolError("fetch cancelled");
    if (error instanceof NetworkPolicyError) return toolError(error.message);
    return toolError(describeFetchError(error));
  }
}

/** Undici wraps every failure in a bare TypeError("fetch failed"); the
 * actionable reason (DNS, TLS, refused, timeout) lives on `cause`. Chain the
 * causes so the model sees what actually went wrong. */
function describeFetchError(error: unknown): string {
  const chain: string[] = [];
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as NodeJS.ErrnoException).code;
    const line = current.message + (code ? ` (${code})` : "");
    if (!chain.includes(line)) chain.push(line);
    current = (current as { cause?: unknown }).cause;
  }
  const joined = chain.join(" ← ");
  if (/timeout/i.test(joined)) return "request timed out";
  if (/ENOTFOUND|EAI_AGAIN/i.test(joined)) return `DNS lookup failed (${joined})`;
  if (/ECONNREFUSED/i.test(joined)) return `connection refused (${joined})`;
  if (/EHOSTUNREACH|ENETUNREACH|ENETDOWN/i.test(joined)) return `network unreachable (${joined})`;
  if (/certificate|SSL|TLS|self-signed/i.test(joined)) return `TLS failure (${joined})`;
  return joined || "fetch failed";
}

// ── web_search: DuckDuckGo HTML Lite, parsed to real results ────────────────
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function parseDuckDuckGoResults(
  html: string,
  limit: number,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seenUrls = new Set<string>();
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const matches = Array.from(html.matchAll(linkRe));

  for (let i = 0; i < matches.length && results.length < limit; i++) {
    const match = matches[i]!;
    const title = decodeEntities(match[2].replace(/<[^>]+>/g, "")).trim();
    let href = decodeEntities(match[1]);

    // Unwrap DuckDuckGo redirect link /l/?uddg=...
    try {
      const wrapped = new URL(href, "https://duckduckgo.com");
      const target = wrapped.searchParams.get("uddg");
      if (target) {
        href = decodeURIComponent(target);
      }
    } catch {
      /* keep raw href */
    }

    if (!title || !href) continue;

    // Validate absolute http/https URL and filter out DuckDuckGo internal/ad links
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(href);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") continue;
      if (parsedUrl.hostname.includes("duckduckgo.com")) continue;
    } catch {
      continue;
    }

    if (seenUrls.has(parsedUrl.href)) continue;
    seenUrls.add(parsedUrl.href);

    // Extract snippet strictly from the slice between this link and the next result link
    const startIndex = match.index! + match[0].length;
    const endIndex = i + 1 < matches.length ? matches[i + 1]!.index! : Math.min(startIndex + 4000, html.length);
    const chunk = html.slice(startIndex, endIndex);

    const snippetMatch = /<(?:a|span|div|td)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|div|td)>/i.exec(chunk);
    const snippet = snippetMatch ? decodeEntities(snippetMatch[1].replace(/<[^>]+>/g, "")).trim() : "";

    results.push({ title, url: parsedUrl.href, snippet });
  }

  return results;
}

async function webSearch(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return toolError("query is required");
  if (query.length > 400) return toolError("query exceeds 400 characters");
  const limitRaw = typeof args.limit === "number" ? Math.floor(args.limit) : 6;
  const limit = Math.min(Math.max(limitRaw, 1), 10);
  try {
    const response = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      body: new URLSearchParams({ q: query }).toString(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) return toolError(`search engine returned HTTP ${response.status}`);
    const html = await response.text();
    const results = parseDuckDuckGoResults(html, limit);
    if (!results.length) return { ok: true, query, results: [], note: "no results parsed; the page layout may have changed" };
    return { ok: true, query, results };
  } catch (error) {
    if (signal.aborted) return toolError("search cancelled");
    return toolError(describeFetchError(error));
  }
}

// ── Program lifecycle: what a package IS, and what this build can do with it ──
// The vocabulary matters: "it ran when I asked npx for it" is not "it is
// installed", and "the runtime can execute it" is not "the app can open it".
// Both questions are answered here so the model never has to guess (or invent)
// a status from a successful command.
type ProgramState = "not_present" | "available_through_npx" | "installed_locally" | "running";

/** The shim's cache: one directory per package spec it has fetched. */
function npxCacheEntry(name: string): { spec: string; dir: string } | null {
  const root = join(WORKSPACE, ".npm", "_npx-shim");
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  const wanted = entries.filter((entry) => entry === name || entry.startsWith(`${name}@`));
  if (!wanted.length) return null;
  // A bare spec beats a pinned one, and the newest pin beats older pins.
  wanted.sort((a, b) => (a === b ? 0 : 0));
  const spec = wanted.find((entry) => entry === name) ?? wanted[wanted.length - 1];
  return { spec, dir: join(root, spec) };
}

/** Installed in this workspace: `<prefix>/node_modules/<name>` with a
 *  package.json — what `npm install` would create, and nothing less. */
function installedLocally(name: string): { version: string | null } | null {
  const dir = join(NPM_PREFIX, "node_modules", name);
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: string };
    return { version: typeof pkg.version === "string" ? pkg.version : null };
  } catch {
    return null;
  }
}

function cachedVersion(dir: string, name: string): string | null {
  // The shim's cache directory holds an installed tree for the spec it
  // fetched, so the package's own manifest sits under node_modules/<name> —
  // the path a person would look at if they opened the folder themselves.
  for (const candidate of [join("node_modules", name, "package.json"), join("node_modules", "package.json"), "package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, candidate), "utf8")) as { version?: string };
      if (typeof pkg.version === "string") return pkg.version;
    } catch {
      // not that one
    }
  }
  return null;
}

/** Processes this app owns whose command line mentions `name`. Other apps'
 *  processes are not readable, and a name match is a hint, not a handle. */
function runningProcesses(name: string): number[] {
  const hits: number[] = [];
  let pids: string[];
  try {
    pids = readdirSync("/proc");
  } catch {
    return hits;
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      // cmdline fields are NUL-separated; split/join rather than a regex that
      // matches a control character.
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\u0000").join(" ").trim();
      if (cmd && cmd.includes(name)) hits.push(Number(pid));
    } catch {
      // not ours, or gone
    }
  }
  return hits;
}

async function packageStatus(name: string): Promise<Record<string, unknown>> {
  const installed = installedLocally(name);
  const cached = npxCacheEntry(name);
  const pids = runningProcesses(name);
  let state: ProgramState = "not_present";
  if (pids.length) state = "running";
  else if (installed) state = "installed_locally";
  else if (cached) state = "available_through_npx";
  const version = installed?.version ?? (cached ? cachedVersion(cached.dir, name) : null);
  const interactive = TERMINAL_READY ? INTERACTIVE_AVAILABLE : INTERACTIVE_SESSION_UNAVAILABLE;
  const terminals = await openTerminalsFor(name);
  return {
    ok: true,
    program: name,
    state,
    version,
    running: pids.length > 0 || terminals.length > 0,
    pids,
    // Live terminal sessions whose program mentions this name. A program can
    // be "running" here without a matching /proc entry of this adapter's own
    // — a terminal is a session, not a process this list can find.
    terminals,
    // What this build can do with an interactive program, stated once and
    // structurally, so the answer never depends on a failed launch attempt.
    interactiveSession: interactive.state,
    interactiveNote: interactive.note,
    states: {
      not_present: "nothing of it is on this phone yet",
      available_through_npx: "npx has it in its cache and can run it again without downloading",
      installed_locally: `installed in this bot's own prefix (${NPM_PREFIX})`,
      running: "a process of it is alive right now",
    }[state],
  };
}

/** The terminals a name is currently running in, if the driver can say. A
 *  driver that is not answering must not make package_status fail: the rest of
 *  its answer is still true. */
async function openTerminalsFor(name: string): Promise<Array<Record<string, unknown>>> {
  if (!TERMINAL_READY) return [];
  try {
    const payload = await terminalCall("/sessions", {}, 5_000);
    const sessions = Array.isArray(payload.sessions) ? (payload.sessions as TerminalSessionView[]) : [];
    const needle = name.toLowerCase();
    return sessions
      .filter((session) =>
        `${session.label} ${session.command}`.toLowerCase().includes(needle),
      )
      .map(sessionListEntry);
  } catch {
    return [];
  }
}

/** What this build can do with interactive programs, stated once and
 *  structurally, so no answer depends on a failed launch attempt. Two builds
 *  exist: the phone build, whose app hosts persistent terminals, and a build
 *  whose adapter was spawned without a terminal driver. The refusal below is
 *  still the honest answer in the second case — and it stays in one place,
 *  because the status tool, the launcher, and the model's guidance all read
 *  it. */
const INTERACTIVE_AVAILABLE = {
  state: "available",
  note: "This phone hosts real terminals: a program opened here keeps running after the turn that opened it ends, and the person can see it on their screen and type into it themselves.",
  say: "it runs in a real terminal on the phone, where the person can use it, and it stays running after this reply",
};

const INTERACTIVE_SESSION_UNAVAILABLE = {
  state: "unavailable",
  note: "This Android build runs one-shot commands; it has no persistent terminal session, so a full-screen interactive program cannot be opened or kept running here.",
  say: "its interactive interface can't be opened in this build — it needs a persistent terminal session, which this Android build does not have yet",
};

/**
 * Open an interactive program in a persistent terminal on the phone.
 *
 * This is the tool's whole reason for existing: the session it starts belongs
 * to the app, not to this adapter, so the program is still running when this
 * turn ends, when the person swipes away from the terminal's screen, and when
 * the harness restarts. On a build with no terminal driver it degrades to the
 * structural refusal it has always given rather than pretending.
 */
async function openInteractive(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const command = String(args.command ?? "").trim();
  if (!command) return toolError("open_interactive needs the command that starts the program.");
  const name = String(args.name ?? "").trim() || splitCommandLine(command).pop() || command;

  if (!TERMINAL_READY) {
    const status = await packageStatus(name);
    // ok:true with success:false — the tool call itself answered correctly, and
    // the answer is "this build cannot host that program". Reporting it as a
    // failed tool call would mark the whole turn as a tool error and put a
    // diagnostic under an answer that is already honest and complete.
    return {
      ok: true,
      success: false,
      reason: "interactive_session_unavailable",
      classification: "interactive",
      command,
      program: name,
      version: status.version ?? null,
      state: status.state,
      interactiveSession: INTERACTIVE_SESSION_UNAVAILABLE.state,
      detail: INTERACTIVE_SESSION_UNAVAILABLE.note,
      // The model reports this outcome in its own words; these are the facts it
      // must not invent around, and the line it must not cross.
      say: typeof status.version === "string"
        ? `I found ${name} ${status.version}, but ${INTERACTIVE_SESSION_UNAVAILABLE.say}, so I haven't opened it.`
        : `I found ${name}, but ${INTERACTIVE_SESSION_UNAVAILABLE.say}, so I haven't opened it.`,
      guidance:
        "Tell the person this plainly in your own words. Do not mention tool names, command lines, file paths, or how the runtime works, and do not tell them to run the command themselves — the phone is the computer and this app is the only place the work happens. Do not claim it opened.",
    };
  }

  const started = (await terminalStart({ ...args, command, label: name, show: args.show !== false })) as
    Record<string, unknown>;
  if (started.ok !== true) {
    // The session could not be created (the program is missing, it cannot run
    // on this phone, or the terminal driver failed). ok:true with
    // success:false, for the same reason as the refusal above: the model must
    // be able to report this without the turn being marked a tool failure.
    return {
      ok: true,
      success: false,
      reason: "terminal_start_failed",
      classification: "interactive",
      command,
      program: name,
      error: String(started.error ?? "the terminal could not be started"),
      say: "I couldn't start the interactive terminal.",
      guidance:
        "Say that plainly in your own words, then say what you would try instead — a different way of starting it, or that this program needs something this phone does not have. Never mention tool names, command lines, file paths, pids, exit codes, or raw errors, never tell the person to run the command themselves, and never claim it opened.",
    };
  }

  const status = await packageStatus(name);
  return {
    ok: true,
    success: true,
    reason: "interactive_session_started",
    classification: "interactive",
    command,
    program: name,
    version: status.version ?? null,
    state: status.state,
    sessionId: started.sessionId,
    label: started.label,
    terminalState: started.state,
    running: true,
    detail:
      "It is running in its own terminal on the phone now, on the person's screen, and it keeps running after this turn ends.",
    // The one line a person reads. Kept short and free of anything about how
    // the runtime works; the app puts the terminal itself on screen.
    say: `Opening ${String(started.label ?? name)}…`,
    guidance:
      "Tell the person it is open and running on their phone, in one plain sentence, and that it keeps running after your reply. Never mention tool names, session ids, pids, paths, or command lines. You can keep watching its output with terminal_read and answer it with terminal_write.",
  };
}

// ── Persistent terminals ────────────────────────────────────────────────────
// A PTY cannot live in this process: the harness spawns a fresh adapter for
// each turn, so a program started here would die with the turn that opened it —
// which is exactly the limitation this replaces. The app owns the terminals
// (android/app/src/main/kotlin/com/openmausbot/companion/terminal/), and this
// section is the client of its loopback API. The port and the capability token
// arrive through the harness environment (AT_DRIVER_PORT / AT_DRIVER_TOKEN),
// the same handoff the browser tools use: loopback only, paths and ports only,
// never a credential.
const TERMINAL_PORT = Number(process.env.AT_DRIVER_PORT ?? "0");
const TERMINAL_TOKEN = process.env.AT_DRIVER_TOKEN ?? "";
const TERMINAL_READY = TERMINAL_PORT > 0 && TERMINAL_TOKEN.length > 0;
/** One tool result of terminal output: bounded, because a busy TUI can print
 *  megabytes and the model's context is the scarce resource. */
const MAX_TERMINAL_BYTES = 16 * 1024;

/** The cursor each session has been read up to, for THIS adapter process. A
 *  fresh adapter (a new turn) reads from the start of what the session still
 *  retains, so a bot that opens a terminal in one turn and looks at it in the
 *  next sees what the person saw rather than an empty answer. */
const terminalCursors = new Map<string, number>();

/** A terminal action that could not be completed, with the driver's own
 *  sentence when it had one. */
class TerminalError extends Error {}

async function terminalCall(
  path: string,
  body: Record<string, unknown> = {},
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  if (!TERMINAL_READY) throw new TerminalError("this build cannot host interactive terminals");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${TERMINAL_PORT}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TERMINAL_TOKEN}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new TerminalError(`the terminal is not answering (HTTP ${response.status})`);
    const payload = (await response.json()) as Record<string, unknown> & { ok?: boolean; error?: string };
    if (payload.ok === false) throw new TerminalError(String(payload.error ?? "the terminal action failed"));
    return payload;
  } catch (error) {
    if (error instanceof TerminalError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new TerminalError(
      /abort/i.test(message) ? "the terminal took too long to answer" : message,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Split a command line the way a shell does for everything a bot writes:
 *  whitespace, single quotes, double quotes. Deliberately not a shell parser —
 *  no expansions, no operators — because what this produces is one program's
 *  argument vector, not a script. */
function splitCommandLine(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) { quote = null; } else { current += ch; }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (current) { words.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) words.push(current);
  return words;
}

/**
 * The program a command names, resolved to something this phone can really
 * execute. node/npm/npx map onto the embedded runtime (the only exec-allowed
 * runtime there is — see publishRuntimeBins), a published bin is used as-is,
 * and everything else is looked for on the system PATH. Nothing here is
 * package-specific: `npx --yes anything` resolves the same way.
 */
function resolveTerminalCommand(command: string): { program: string; args: string[]; name: string } {
  const words = splitCommandLine(command);
  if (!words.length) throw new TerminalError("there is no command to run");
  const [name, ...rest] = words;
  if (name.startsWith("/")) {
    return { program: name, args: rest, name: name.split("/").filter(Boolean).pop() ?? name };
  }
  const builtin: Record<string, { program: string; args: string[] }> = {
    node: { program: NODE_BIN, args: [] },
    npm: { program: NODE_BIN, args: [NPM_CLI] },
    npx: { program: NODE_BIN, args: [NPX_SHIM] },
    sh: { program: `${SYSTEM_BIN}/sh`, args: [] },
  };
  const mapped = builtin[name];
  if (mapped) return { program: mapped.program, args: [...mapped.args, ...rest], name };
  const published = join(BOT_BIN_DIR, name);
  if (existsSync(published)) return { program: published, args: rest, name };
  for (const dir of COMMAND_PATH.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return { program: candidate, args: rest, name };
  }
  throw new TerminalError(`this phone has no program called "${name}"`);
}

/** The environment a terminal's program runs in: the same one a run_shell
 *  call gets, so PATH, HOME, TMPDIR, the npm prefix and the runtime wiring do
 *  not differ between "a command" and "a program you can type into". */
function terminalEnvironment(): Record<string, string> {
  return shellEnv();
}

/** A session as the model may see it: no pid, no file descriptors, no paths. */
interface TerminalSessionView {
  id: string;
  label: string;
  command: string;
  botId: string | null;
  rows: number;
  cols: number;
  cursor: number;
  terminal: boolean;
  state: { running: boolean; exitCode: number | null; signal: number | null; closed: boolean };
}

function sessionView(payload: Record<string, unknown>): TerminalSessionView {
  const session = payload.session as TerminalSessionView | undefined;
  if (!session || typeof session.id !== "string") throw new TerminalError("the terminal did not report a session");
  return session;
}

/** How a session's state reads to a model that must describe it truthfully. */
function describeSession(session: TerminalSessionView): string {
  if (session.state.running) return "running";
  if (typeof session.state.signal === "number") return "stopped";
  if (typeof session.state.exitCode === "number") return "exited";
  return "closed";
}

/** The session list, minus everything a model has no business describing. */
function sessionListEntry(session: TerminalSessionView): Record<string, unknown> {
  return {
    sessionId: session.id,
    label: session.label,
    command: session.command,
    state: describeSession(session),
    running: session.state.running,
    exitCode: session.state.exitCode ?? null,
    signal: session.state.signal ?? null,
    rows: session.rows,
    cols: session.cols,
    terminal: session.terminal,
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** Start a program in its own terminal, on the phone, owned by the app. */
async function terminalStart(args: Record<string, unknown>): Promise<unknown> {
  const command = String(args.command ?? "").trim();
  if (!command) return toolError("terminal_start needs the command that starts the program.");
  let resolved: { program: string; args: string[]; name: string };
  try {
    resolved = resolveTerminalCommand(command);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
  const label = String(args.label ?? "").trim() || resolved.name;
  try {
    const payload = await terminalCall("/start", {
      program: resolved.program,
      args: resolved.args,
      env: terminalEnvironment(),
      cwd: WORKSPACE,
      rows: clampInt(args.rows, 12, 200, 30),
      cols: clampInt(args.cols, 40, 300, 80),
      label,
      command,
      botId: typeof args.botId === "string" ? args.botId : "",
      show: args.show !== false,
    });
    const session = sessionView(payload);
    terminalCursors.set(session.id, session.cursor);
    return {
      ok: true,
      sessionId: session.id,
      label: session.label,
      command,
      state: describeSession(session),
      running: session.state.running,
      rows: session.rows,
      cols: session.cols,
      terminal: session.terminal,
      note: "The terminal is on the person's screen now and keeps running after this turn ends. Read it with terminal_read, answer it with terminal_write, resize it with terminal_resize, and end it with terminal_close.",
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

/** Type into a running program, or send it named keys. */
async function terminalWrite(args: Record<string, unknown>): Promise<unknown> {
  const sessionId = String(args.sessionId ?? "").trim();
  if (!sessionId) return toolError("terminal_write needs the session id from terminal_start.");
  const text = typeof args.text === "string" ? args.text : "";
  const keys = Array.isArray(args.keys) ? args.keys.map((key) => String(key)) : [];
  if (!text && !keys.length && args.enter !== true) {
    return toolError("terminal_write needs text, keys, or enter:true.");
  }
  try {
    const payload = await terminalCall(`/session/${sessionId}/write`, {
      text,
      keys,
      enter: args.enter === true,
    });
    const session = sessionView(payload);
    return {
      ok: true,
      sessionId,
      wrote: payload.written ?? 0,
      state: describeSession(session),
      running: session.state.running,
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

/** Read what a program has printed since this bot last looked. */
async function terminalRead(args: Record<string, unknown>): Promise<unknown> {
  const sessionId = String(args.sessionId ?? "").trim();
  if (!sessionId) return toolError("terminal_read needs the session id from terminal_start.");
  const cursor = args.fromStart === true ? 0 : terminalCursors.get(sessionId) ?? 0;
  const waitMs = clampInt(args.waitMs, 0, 30_000, 0);
  try {
    const payload = await terminalCall(
      `/session/${sessionId}/read`,
      { cursor, maxBytes: 64 * 1024, waitMs },
      waitMs + 30_000,
    );
    const raw = typeof payload.data === "string" ? payload.data : "";
    const next = typeof payload.cursor === "number" ? payload.cursor : cursor;
    terminalCursors.set(sessionId, next);
    const session = sessionView(payload);
    const output = bounded(raw, MAX_TERMINAL_BYTES, " [output truncated]");
    return {
      ok: true,
      sessionId,
      output,
      chars: raw.length,
      truncated: output !== raw,
      missedEarlierOutput: payload.missed === true,
      newOutput: payload.waited === true,
      state: describeSession(session),
      running: session.state.running,
      exitCode: session.state.exitCode ?? null,
      signal: session.state.signal ?? null,
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

/** Match the program's idea of the terminal to the screen it is on. */
async function terminalResize(args: Record<string, unknown>): Promise<unknown> {
  const sessionId = String(args.sessionId ?? "").trim();
  if (!sessionId) return toolError("terminal_resize needs the session id from terminal_start.");
  try {
    const payload = await terminalCall(`/session/${sessionId}/resize`, {
      rows: clampInt(args.rows, 2, 400, 30),
      cols: clampInt(args.cols, 20, 500, 80),
    });
    return { ok: true, sessionId, rows: payload.rows, cols: payload.cols };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

/** End a session: hang the program up, release its terminal, forget it. */
async function terminalClose(args: Record<string, unknown>): Promise<unknown> {
  const sessionId = String(args.sessionId ?? "").trim();
  if (!sessionId) return toolError("terminal_close needs the session id from terminal_start.");
  try {
    const payload = await terminalCall(`/session/${sessionId}/close`, { force: args.force === true });
    terminalCursors.delete(sessionId);
    const session = sessionView(payload);
    return {
      ok: true,
      sessionId,
      closed: true,
      exitCode: session.state.exitCode ?? null,
      signal: session.state.signal ?? null,
      stillRunning: session.state.running,
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

/** Every terminal this phone is hosting right now. */
async function terminalList(): Promise<unknown> {
  try {
    const payload = await terminalCall("/sessions", {});
    const sessions = Array.isArray(payload.sessions) ? (payload.sessions as TerminalSessionView[]) : [];
    return {
      ok: true,
      count: sessions.length,
      sessions: sessions.map(sessionListEntry),
      note: sessions.length
        ? "A session stays alive until terminal_close ends it, whether or not the person is looking at its screen."
        : "No terminals are open on this phone.",
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

// ── Tool registry ───────────────────────────────────────────────────────────
// One entry per tool: description + JSON-Schema + handler. tools/list is
// derived from this table; adding a tool is a single new row.
const WORKSPACE_DESC = "Paths are workspace-relative; \".\" is the workspace root. Absolute paths are treated as workspace-absolute.";

/**
 * How the model should describe the runtime, which depends on whether this
 * build ships the native launcher.
 *
 * With it, npm/npx are ordinary executables on PATH for every kind of caller —
 * a shell, a spawned subprocess, a background job, an npm script, a program
 * inside a terminal. Without it, they are reachable from a shell (and through
 * the shim paths from anywhere), which is what the earlier build could do. The
 * tool description states the true one, so the model never has to discover the
 * difference by failing.
 */
const NODE_ROUTE = hasNativeLauncher()
  ? "`node`, `npm` and `npx` are executable files on PATH, and every kind of caller finds them — this shell, a spawned subprocess, a background job, an npm script, and a program running inside a terminal session."
  : "`node` is an executable on PATH; in THIS shell `npm`/`npx` work directly, while a spawned subprocess, a background job or an npm script must go through the runtime with \"$OMB_NPM_CLI\" or \"$OMB_NPX_SHIM\".";

type ToolHandler = (args: Record<string, unknown>, signal: AbortSignal) => unknown | Promise<unknown>;
interface ToolSpec {
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

const TOOLS: Record<string, ToolSpec> = {
  workspace_list: {
    description: `List a workspace directory. ${WORKSPACE_DESC}`,
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Directory to list" } } },
    handler: (a) => workspaceList(a),
  },
  workspace_read: {
    description: `Read a text file (capped at ${MAX_READ_BYTES / 1024}KB). ${WORKSPACE_DESC}`,
    inputSchema: { type: "object", properties: { path: { type: "string" }, encoding: { type: "string", enum: ["utf8", "base64"] } }, required: ["path"] },
    handler: (a) => workspaceRead(a),
  },
  workspace_write: {
    description: `Write (create or replace) a file. ${WORKSPACE_DESC}`,
    inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, encoding: { type: "string", enum: ["utf8", "base64"] } }, required: ["path"] },
    handler: (a) => workspaceWrite(a),
  },
  workspace_append: {
    description: `Append to a file, creating it if missing. ${WORKSPACE_DESC}`,
    inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, encoding: { type: "string", enum: ["utf8", "base64"] } }, required: ["path"] },
    handler: (a) => workspaceAppend(a),
  },
  workspace_mkdir: {
    description: `Create a directory. ${WORKSPACE_DESC}`,
    inputSchema: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } }, required: ["path"] },
    handler: (a) => workspaceMkdir(a),
  },
  workspace_move: {
    description: `Rename/move a file. ${WORKSPACE_DESC}`,
    inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
    handler: (a) => workspaceMove(a),
  },
  workspace_copy: {
    description: `Copy a file. ${WORKSPACE_DESC}`,
    inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
    handler: (a) => workspaceCopy(a),
  },
  workspace_delete: {
    description: `Delete a file, or a directory with recursive=true. Destructive. ${WORKSPACE_DESC}`,
    inputSchema: { type: "object", properties: { path: { type: "string" }, recursive: { type: "boolean" } }, required: ["path"] },
    handler: (a) => workspaceDelete(a),
  },
  workspace_stat: {
    description: `File metadata (size, type, mtime). ${WORKSPACE_DESC}`,
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    handler: (a) => workspaceStat(a),
  },
  workspace_exists: {
    description: `Check existence. ${WORKSPACE_DESC}`,
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    handler: (a) => workspaceExists(a),
  },
  run_command: {
    description: "Execute an allowlisted Android (toybox) command in the workspace: ls, cat, head, tail, wc, stat, du, find, grep, sed, awk, sort, uniq, cut, tr, diff, mkdir, touch, cp, mv, rm, rmdir, tee, base64, md5sum, sha256sum, uname, date, uptime, id, whoami, nproc, free, df, getprop, logcat, ps, printenv, ping, nslookup. No shell, no pipes, no redirects; arguments are passed verbatim.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Allowlisted command name" },
        args: { type: "array", items: { type: "string" }, description: "Arguments; flags like -n are fine, pipes/redirection are not available" },
        timeoutMs: { type: "integer", description: "Kill after this long (default 10s, max 30s)" },
      },
      required: ["command"],
    },
    handler: runCommand,
  },
  run_shell: {
    description: `Run an arbitrary shell command with FULL terminal access — a real sh -c pass: pipes, redirects, subshells, environment, wildcards, and any binary on PATH (toybox applets, pm, dumpsys, am, getprop…). Absolute paths work everywhere this app can reach, e.g. /sdcard/Download. Working directory is the bot workspace; use cd for anywhere else. Node.js is built in: ${NODE_ROUTE} (npx --yes <pkg> runs pure-JavaScript packages; native/bin-compiled packages are refused by Android). Check what a package is with package_status before describing it, and use open_interactive — never this tool — for a program with a full-screen or interactive interface: a command run here finishes or dies with the call, and only open_interactive's terminal keeps a program alive. Prefer run_command for a single allowlisted applet; use this for everything else.`,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command line, exactly as you would type it" },
        timeoutMs: { type: "integer", description: "Kill after this long (default 30s, max 60s)" },
      },
      required: ["command"],
    },
    handler: runShell,
  },
  package_status: {
    description:
      "What a package actually IS on this phone, before you describe it to anyone: not_present, available_through_npx (npx has it cached and can run it again), installed_locally (in this bot's own npm prefix), or running. Also reports the version it can see, any terminals it is running in, and whether this build can host interactive programs. Use this instead of inferring a status from a successful command: a package that npx downloaded and ran is available_through_npx, NOT installed.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Package or program name, e.g. torlnk" },
      },
      required: ["name"],
    },
    handler: (a) => packageStatus(String(a.name ?? "").trim()),
  },
  open_interactive: {
    description:
      "Open a program that has a full-screen or interactive interface (a TUI, a prompt, anything that waits for keystrokes) — this is the ONLY tool for that, and it is the ONLY way to start a program that has to keep running. Never start one with run_shell, nohup, or a background job: those die with the call. Returns the session: the program is running in a real terminal on the person's phone, on their screen, and it stays running after this turn ends. Then use terminal_write to answer it, terminal_read to see what it printed, terminal_resize or terminal_close when needed. If this build cannot host an interactive session it says so structurally with reason interactive_session_unavailable; report that limit honestly and never tell the person to run the command themselves.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command that starts the program, e.g. npx --yes torlnk" },
        name: { type: "string", description: "Program name, when it differs from the last word of the command" },
        rows: { type: "integer", description: "Terminal height in rows (default 30); the person's screen resizes it live" },
        cols: { type: "integer", description: "Terminal width in columns (default 80)" },
      },
      required: ["command"],
    },
    handler: (a) => openInteractive(a),
  },
  terminal_start: {
    description:
      "Start a program in its own terminal on the phone and return a session id. The program keeps running after this turn, while the person watches or types in it, until terminal_close ends it. Use this for anything that waits for input; for a program with a full-screen interface prefer open_interactive (same session machinery, plus the person-facing answer).",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command that starts the program, e.g. npx --yes torlnk" },
        label: { type: "string", description: "What to call it on the person's screen (defaults to the program name)" },
        rows: { type: "integer" },
        cols: { type: "integer" },
        show: { type: "boolean", description: "Bring the terminal to the person's screen now (default true)" },
      },
      required: ["command"],
    },
    handler: (a) => terminalStart(a),
  },
  terminal_write: {
    description:
      "Send input to a running terminal: text, named keys, or Enter. This is what a person's keystrokes do. Named keys include enter, tab, escape, up, down, left, right, backspace, delete, ctrl-c, ctrl-d, ctrl-z — use ctrl-c to interrupt, and prefer keys over guessing a control character.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session id from terminal_start or open_interactive" },
        text: { type: "string", description: "Literal text to type; a newline in it is Enter" },
        keys: { type: "array", items: { type: "string" }, description: "Named keys to press, e.g. [\"enter\"]" },
        enter: { type: "boolean", description: "Press Enter after the text" },
      },
      required: ["sessionId"],
    },
    handler: (a) => terminalWrite(a),
  },
  terminal_read: {
    description:
      "Read what a terminal has printed since this bot last read it. Returns the new output with escape sequences removed, plus the session's state. Set waitMs to wait for the program to print something rather than asking again immediately (it returns as soon as output arrives or the wait ends). A program that has exited is reported as exited with its exit status.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        waitMs: { type: "integer", description: "Wait up to this long for new output (default 0, max 30000)" },
        fromStart: { type: "boolean", description: "Read the whole retained output again instead of only what is new" },
      },
      required: ["sessionId"],
    },
    handler: (a) => terminalRead(a),
  },
  terminal_resize: {
    description:
      "Set a terminal's size in rows and columns. The program is notified the way a real terminal notifies it, so a full-screen program reflows. The person's own screen does this automatically while they are looking at it.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        rows: { type: "integer" },
        cols: { type: "integer" },
      },
      required: ["sessionId", "rows", "cols"],
    },
    handler: (a) => terminalResize(a),
  },
  terminal_close: {
    description:
      "End a terminal: the program is hung up and killed if it does not stop, its terminal is released, and the session is removed. Use this when the person asks to close it or when the work in it is done — nothing else cleans a session up.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        force: { type: "boolean", description: "Skip the graceful hangup and stop it immediately" },
      },
      required: ["sessionId"],
    },
    handler: (a) => terminalClose(a),
  },
  terminal_list: {
    description:
      "Every terminal this phone is hosting right now, with its state. Use it before starting something that may already be running, or to find the session id of a terminal opened in an earlier turn.",
    inputSchema: { type: "object", properties: {} },
    handler: () => terminalList(),
  },
  http_fetch: {
    description: "Perform a real HTTP/HTTPS request and return status, headers and body. Private/loopback destinations and credential headers are refused; redirects are followed only while they stay public. No credentials are available to this tool; do not ask for them.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] },
        headers: { type: "object", additionalProperties: { type: "string" } },
        body: { type: "string", description: "Request body (JSON default content-type)" },
        timeoutMs: { type: "integer" },
      },
      required: ["url"],
    },
    handler: httpFetch,
  },
  web_search: {
    description: "Search the live web and return real results (title, url, snippet). Use for anything time-sensitive or outside your knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 10, description: "Max results (default 6)" },
      },
      required: ["query"],
    },
    handler: webSearch,
  },
  // ── internet resource tools (android-resources.ts): the acquisition
  // layer — inspect/fetch/download URLs, PDF text extraction, HTML
  // link/image extraction, artifact manifest. Same SSRF guard as http_fetch,
  // same workspace sandbox as the workspace_* tools, same approval flow. ──
  ...Object.fromEntries(
    Object.entries(RESOURCE_TOOLS).map(([name, spec]) => [name, {
      description: spec.description,
      inputSchema: spec.inputSchema,
      handler: (args: Record<string, unknown>, signal: AbortSignal) =>
        spec.handler(WORKSPACE, args, signal),
    }]),
  ),
  // ── full-stack app builder tools (server/app-builder/app-builder-tools.ts) ──
  ...Object.fromEntries(
    Object.entries(APP_BUILDER_TOOLS).map(([name, spec]) => [name, {
      description: spec.description,
      inputSchema: spec.inputSchema,
      handler: (args: Record<string, unknown>, signal: AbortSignal) =>
        spec.handler(args, signal),
    }]),
  ),
  // ── device capability registry tools (server/capabilities/capability-registry.ts) ──
  ...Object.fromEntries(
    Object.entries(DEVICE_CAPABILITY_TOOLS).map(([name, spec]) => [name, {
      description: spec.description,
      inputSchema: spec.inputSchema,
      handler: (args: Record<string, unknown>, signal: AbortSignal) =>
        spec.handler(args, signal),
    }]),
  ),
  // ── general-purpose computer agent tools (server/computer-agent/agent-tools.ts) ──
  ...Object.fromEntries(
    Object.entries(COMPUTER_AGENT_TOOLS).map(([name, spec]) => [name, {
      description: spec.description,
      inputSchema: spec.inputSchema,
      handler: (args: Record<string, unknown>, signal: AbortSignal) =>
        spec.handler(args, signal),
    }]),
  ),
};

const TOOL_LIST = Object.entries(TOOLS).map(([name, spec]) => ({
  name,
  description: spec.description,
  inputSchema: spec.inputSchema,
}));

function textResult(payload: unknown, isError = false): unknown {
  const full = JSON.stringify(payload, null, 1);
  if (Buffer.byteLength(full) <= MAX_OUTPUT_BYTES) {
    return { content: [{ type: "text", text: full }], ...(isError ? { isError: true } : {}) };
  }
  // Over the cap. Never cut the SERIALIZED JSON: a mid-`\uXXXX` escape or an
  // unterminated string hands the caller invalid JSON. Shrink the payload's
  // own string fields instead — cutting RAW strings keeps re-serialization
  // valid because escaping happens afterwards (lone surrogates included:
  // well-formed JSON.stringify escapes them, and JSON allows those escapes).
  const shrunk: Record<string, unknown> = { ...(payload as Record<string, unknown>), truncated: true };
  const strings = Object.entries(shrunk).filter(([, v]) => typeof v === "string") as Array<[string, string]>;
  const totalStringBytes = strings.reduce((sum, [, v]) => sum + Buffer.byteLength(v), 0);
  const otherBytes = Buffer.byteLength(full) - totalStringBytes;
  if (totalStringBytes > 0 && otherBytes < MAX_OUTPUT_BYTES) {
    const budget = MAX_OUTPUT_BYTES - otherBytes - 256;
    for (const [name, value] of strings) {
      const share = Math.max(1024, Math.floor(budget * (Buffer.byteLength(value) / totalStringBytes)));
      shrunk[name] = bounded(value, share);
    }
  }
  return { content: [{ type: "text", text: JSON.stringify(shrunk, null, 1) }], ...(isError ? { isError: true } : {}) };
}

let shuttingDown = false;
process.on("SIGTERM", () => {
  shuttingDown = true;
  process.exit(0);
});
process.on("SIGINT", () => process.exit(0));

function checkPermissionForTool(toolName: string, args?: Record<string, unknown>): { allowed: boolean; reason?: string } {
  const permissions = loadDiskPermissions();
  const res = checkToolPermission(toolName, permissions, args);
  return { allowed: res.allowed, reason: res.reason };
}

function handle(message: RpcMessage): void {
  const id = message.id;
  if (typeof id !== "number" && typeof id !== "string") return;
  if (message.method === "initialize") {
    reply(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "android_computer", version: "1.0.0" },
    });
    return;
  }
  if (message.method === "tools/list") {
    reply(id, { tools: TOOL_LIST });
    return;
  }
  if (message.method === "tools/call") {
    const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
    const name = typeof params.name === "string" ? params.name : "";
    const spec = TOOLS[name];
    if (!spec) {
      replyError(id, `unknown tool: ${name}`, -32602);
      return;
    }
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const permCheck = checkPermissionForTool(name, args);
    if (!permCheck.allowed) {
      reply(id, textResult(toolError(permCheck.reason || "Permission Denied"), true));
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.on("SIGTERM", abort);
    Promise.resolve()
      .then(() => spec.handler(args, controller.signal))
      .then(
        (result) => {
          process.removeListener("SIGTERM", abort);
          if (shuttingDown) return;
          // isError is for refusals and transport failures — payloads the
          // model cannot act on. An executed command's non-zero exit, a
          // timeout, or an HTTP error status is a *result*: the model reads
          // stdout/stderr/exitCode/timedOut and decides what to do next.
          // Tool-refusal payloads carry only { ok:false, error }.
          const failed = (result as { ok?: unknown }).ok === false &&
            !("exitCode" in (result as object)) && !("timedOut" in (result as object));
          reply(id, textResult(result, failed));
        },
        (error) => {
          process.removeListener("SIGTERM", abort);
          if (shuttingDown) return;
          const message = error instanceof Error ? error.message : String(error);
          reply(id, textResult(toolError(message), true));
        },
      );
    return;
  }
  if (message.method === "ping") {
    reply(id, {});
    return;
  }
  if (message.method === "notifications/initialized") return;
  replyError(id, "method not supported", -32601);
}

if (isMainScript) {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (++frames > MAX_FRAMES) {
        process.stderr.write("android-computer: frame limit exceeded\n");
        process.exit(2);
      }
      if (Buffer.byteLength(line) > FRAME_BYTES) {
        process.stderr.write("android-computer: frame too large\n");
        process.exit(2);
      }
      let message: RpcMessage;
      try {
        message = JSON.parse(line);
      } catch {
        // Unparseable frames cannot be tied to a request id; nothing to reply to.
        process.stderr.write("android-computer: invalid JSON frame\n");
        continue;
      }
      try {
        handle(message);
      } catch (error) {
        const id = (message as { id?: unknown }).id;
        if (typeof id === "number" || typeof id === "string") {
          replyError(id, error instanceof Error ? error.message : String(error));
        }
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
