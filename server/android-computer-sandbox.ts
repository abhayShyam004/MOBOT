// Path containment for the Android computer adapter's workspace tools.
//
// The adapter runs as the phone host's own MCP server; its workspace is the
// only filesystem it may touch. Containment is canonical-path based: every
// user-supplied path is resolved (following symlinks, which Android app data
// should not contain but a hostile file could create) and must stay inside
// the workspace root. `..` components, absolute paths pointing outside, URL
// encodings (%2e%2e is just a name), NUL bytes and null bytes all fail here
// rather than at the filesystem.
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/** The workspace is small by design: a bot desk, not a disk. */
export const MAX_PATH_CHARS = 1_024;
export const MAX_FILE_BYTES = 8 * 1_024 * 1_024;
export const MAX_READ_BYTES = 256 * 1_024;
export const MAX_OUTPUT_BYTES = 256 * 1_024;
export const MAX_LIST_ENTRIES = 2_000;

export class SandboxError extends Error {}

function fail(message: string): never {
  throw new SandboxError(message);
}

/** Decode nothing: URL-encoding is not a path syntax here. Only NUL is
 * rejected up front (paths with NUL throw ENOENT deep in the stack with a
 * useless message; say so plainly instead). */
function clean(p: unknown): string {
  if (typeof p !== "string") fail("path must be a string");
  if (!p.length) fail("path must not be empty");
  if (p.length > MAX_PATH_CHARS) fail(`path exceeds ${MAX_PATH_CHARS} characters`);
  if (p.includes("\0")) fail("path must not contain NUL characters");
  return p;
}

/** Absolute workspace path for a user-supplied relative path, guaranteed
 * (canonically, symlinks included) to be inside `root`. */
export function resolveInside(root: string, userPath: string): string {
  const raw = clean(userPath);
  // A leading "/" is just a workspace-absolute spelling, not an escape: join
  // drops it. Everything else (.., symlink targets) is caught by realpath.
  const joined = resolve(join(root, raw));
  if (joined !== root && !joined.startsWith(root + sep)) {
    fail("path escapes the workspace");
  }
  // Canonical containment: the root itself is realized first (its ancestors
  // are app-private and pre-existing), then each path that exists is
  // realpathed; a symlink pointing outside dies here. For the final
  // component that may not exist yet (write/mkdir), the nearest existing
  // ancestor must also be contained, so `link -> /etc` cannot be created.
  const realRoot = realpathSync(root);
  let target = joined;
  let suffix = "";
  for (;;) {
    let real: string | null = null;
    try {
      real = realpathSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") fail("path could not be resolved");
      // Missing tail: walk up to the nearest existing ancestor.
    }
    if (real !== null) {
      const resolved = join(real, suffix);
      if (resolved !== realRoot && !resolved.startsWith(realRoot + sep)) {
        fail("path escapes the workspace (symlink)");
      }
      return resolved;
    }
    if (target === dirname(target)) fail("path escapes the workspace");
    suffix = join(target.slice(target.lastIndexOf(sep) + 1), suffix);
    target = dirname(target);
  }
}

/** Refuse writes that would land on the root itself or replace a directory
 * with a file (readlink target files are the lease pattern's payloads; the
 * workspace holds none, but the guard is free). */
export function assertWritableTarget(path: string): void {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    return; // does not exist yet — fine
  }
  if (info.isDirectory()) fail("target is a directory");
}

/** Toybox applets the adapter will execute. Commands run as direct argv
 * spawns of /system/bin/<name> (no shell anywhere), so injection is
 * structurally impossible; the allowlist exists so a model cannot wander
 * into Android's system internals. */
export const COMMAND_ALLOWLIST: ReadonlySet<string> = Object.freeze(new Set([
  // file inspection
  "ls", "cat", "head", "tail", "wc", "stat", "du", "find", "grep", "sed",
  "awk", "sort", "uniq", "cut", "tr", "diff", "mkdir", "touch", "cp", "mv",
  "rm", "rmdir", "tee",
  // text/encoding
  "base64", "md5sum", "sha1sum", "sha256sum",
  // system introspection (safe, read-only)
  "uname", "date", "uptime", "id", "whoami", "nproc", "free", "df",
  "getprop", "logcat", "ps", "printenv", "sleep",
  // network utilities
  "ping", "nslookup",
]));

/** Where allowlisted applets are resolved. Android's toybox lives in
 * /system/bin; AC_SYSTEM_BIN exists purely so the integration suite can run
 * the same contract against the host's coreutils in CI/dev. */
export const SYSTEM_BIN = process.env.AC_SYSTEM_BIN ?? "/system/bin";

/** The only PATH the command tool searches. Nothing outside SYSTEM_BIN is
 * offered, so even an allowlisted name resolves to toybox or fails. */
export const COMMAND_PATH = "/system/bin:/system/xbin";

export const COMMAND_TIMEOUT_MS_MAX = 30_000;
export const COMMAND_TIMEOUT_MS_DEFAULT = 10_000;
export const MAX_ARGS = 64;
export const MAX_ARG_CHARS = 4_096;

/** Environment for spawned commands: stable, minimal, no credentials and no
 * harness variables (the proxy's own env is never passed through). */
export function commandEnv(workspace: string): Readonly<Record<string, string>> {
  return Object.freeze({
    PATH: COMMAND_PATH,
    HOME: workspace,
    TMPDIR: join(workspace, ".tmp"),
    LANG: "C.UTF-8",
    // getprop works without it; androidboot props come from the OS.
  });
}

export interface PreparedCommand {
  file: string;
  args: string[];
  env: Record<string, string>;
  timeoutMs: number;
}

/** Build a safe argv for an allowlisted command. Throws SandboxError on
 * anything suspicious. */
export function prepareCommand(
  workspace: string,
  command: string,
  args: unknown,
  timeoutMs: unknown,
): PreparedCommand {
  if (typeof command !== "string" || !command.trim()) fail("command must be a non-empty string");
  if (command.length > 64) fail("command name too long");
  if (command.includes("/") || command.includes("\\")) fail("command must be a bare name (no paths)");
  if (command.includes("\0")) fail("command must not contain NUL characters");
  const resolved = COMMAND_ALLOWLIST.has(command) ? command : null;
  if (!resolved) {
    fail(`command not allowed: ${command}. Available: ${[...COMMAND_ALLOWLIST].join(", ")}`);
  }
  if (args === undefined || args === null) {
    args = [];
  }
  if (!Array.isArray(args)) fail("args must be an array of strings");
  if (args.length > MAX_ARGS) fail(`too many arguments (max ${MAX_ARGS})`);
  for (const arg of args) {
    if (typeof arg !== "string") fail("args must be strings");
    if (arg.length > MAX_ARG_CHARS) fail(`argument exceeds ${MAX_ARG_CHARS} characters`);
    if (arg.includes("\0")) fail("argument must not contain NUL characters");
  }
  let timeout = COMMAND_TIMEOUT_MS_DEFAULT;
  if (timeoutMs !== undefined && timeoutMs !== null) {
    if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100) {
      fail("timeoutMs must be an integer >= 100");
    }
    if (timeoutMs > COMMAND_TIMEOUT_MS_MAX) fail(`timeoutMs exceeds the ${COMMAND_TIMEOUT_MS_MAX / 1000}s limit`);
    timeout = timeoutMs;
  }
  return {
    // Direct argv spawn of the toybox applet — no shell pass, so argument
    // bytes can never be reinterpreted as syntax.
    file: `${SYSTEM_BIN}/${resolved}`,
    args: [...args],
    env: { ...commandEnv(workspace) },
    timeoutMs: timeout,
  };
}
