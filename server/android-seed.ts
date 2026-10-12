// Phase 4 (Android computer): seed the android_computer MCP server into the
// workspace config on first boot of the harness on Android.
//
// Upstream's turn pipeline already mounts config.json `mcpServers` for
// engines that declare `customMcp` (openai-compat does), spawning each as a
// stdio MCP process with its tools offered as native function tools through
// the existing permission flow. This module only ever ADDS the one server the
// Android build ships (idempotent): `android_computer`, run by the host's own
// Node binary (`/proc/self/exe`) from the extracted server directory, pointed
// at the sandboxed workspace. It never edits, reorders, or removes anything
// the user configured; it never touches any other config field.
//
// This module is imported ONLY by the Android entry (index-android.ts); it is
// deliberately not part of the desktop bundle.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseStoredMcpServer } from "./mcp-registry.ts";

/** The name must pass mcpServerNameError: 1–32 of [a-z0-9_-] starting with a
 * letter, and not one of the reserved names. "android_computer" qualifies. */
export const ANDROID_COMPUTER_SERVER_NAME = "android_computer";
/** Phase 7: the bots' browser tools (WebView engine, app-side driver). */
export const ANDROID_BROWSER_SERVER_NAME = "android_browser";

export interface SeedArgs {
  dataDir: string;
  /** Absolute path of the extracted android-computer bundle. */
  proxyPath: string;
  /** Absolute sandbox root the adapter may touch. */
  workspace: string;
  /** Phase 7: path of the bundled android-browser server + driver handoff.
   *  Absent (or port 0) means the build has no browser layer and nothing is
   *  seeded — the bots' tool list simply has no browser tools. */
  browser?: { proxyPath: string; driverPort: number; driverToken: string; sessionsRoot: string };
  /** Phase 8: the app-side terminal driver handoff. The terminal_* and
   *  open_interactive tools live in the android_computer adapter itself (the
   *  browser needed its own server; terminals do not), so this is an env field
   *  on that entry rather than a second server. Absent (or port 0) means the
   *  build hosts no terminals, and the adapter keeps answering interactively
   *  with its structural refusal. */
  terminal?: { driverPort: number; driverToken: string };
  log?: (message: string) => void;
}

/** True when the stored entry already matches what this boot would write. The
 *  terminal handoff is part of the match in both directions: a boot that has
 *  one requires it present and current, and a boot that has none requires it
 *  absent, so a stale port from a previous run is always rewritten. */
export function entryMatches(
  existing: unknown,
  proxyPath: string,
  workspace: string,
  terminal?: SeedArgs["terminal"],
): boolean {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return false;
  const entry = existing as Record<string, unknown>;
  if (
    entry.enabled !== true ||
    entry.command !== "/proc/self/exe" ||
    !Array.isArray(entry.args) ||
    entry.args.length !== 1 ||
    entry.args[0] !== proxyPath ||
    typeof entry.env !== "object" ||
    entry.env === null ||
    Array.isArray(entry.env)
  ) {
    return false;
  }
  const env = entry.env as Record<string, string>;
  if (env.AC_WORKSPACE !== workspace) return false;
  const wantedPort = terminal && terminal.driverPort > 0 && terminal.driverToken ? terminal : undefined;
  return wantedPort
    ? env.AT_DRIVER_PORT === String(wantedPort.driverPort) && env.AT_DRIVER_TOKEN === wantedPort.driverToken
    : env.AT_DRIVER_PORT === undefined && env.AT_DRIVER_TOKEN === undefined;
}

/** True when the stored browser entry matches what this boot would write.
 *  Same shape rule as entryMatches: one owner per field, no partial matches. */
export function browserEntryMatches(existing: unknown, browser: NonNullable<SeedArgs["browser"]>): boolean {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return false;
  const entry = existing as Record<string, unknown>;
  const env = entry.env;
  return (
    entry.enabled === true &&
    entry.command === "/proc/self/exe" &&
    Array.isArray(entry.args) &&
    entry.args.length === 1 &&
    entry.args[0] === browser.proxyPath &&
    typeof env === "object" &&
    env !== null &&
    !Array.isArray(env) &&
    (env as Record<string, string>).AB_DRIVER_PORT === String(browser.driverPort) &&
    (env as Record<string, string>).AB_DRIVER_TOKEN === browser.driverToken &&
    (env as Record<string, string>).AB_SESSIONS_ROOT === browser.sessionsRoot
  );
}

/** Add android_computer to mcpServers when absent or stale. Idempotent and
 * conservative: a parse failure of the existing entry leaves the file alone
 * (the user may be mid-edit; the next boot retries), and a fully valid match
 * performs no write at all. Returns "written" | "current" | "skipped". */
export function seedAndroidComputerServer({ dataDir, proxyPath, workspace, browser, terminal, log = () => {} }: SeedArgs):
  "written" | "current" | "skipped" {
  const configPath = join(dataDir, "config.json");
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    // No config yet (first boot) is the normal seeding path; an unreadable
    // one is left for the user/next boot.
    config = {};
  }
  const mcpServers = (
    config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
      ? { ...(config.mcpServers as Record<string, unknown>) }
      : {}
  );
  const terminalHandoff = terminal && terminal.driverPort > 0 && terminal.driverToken ? terminal : undefined;
  const desired: Record<string, unknown> = {
    command: "/proc/self/exe",
    args: [proxyPath],
    // OMB_* env names are harness-reserved in mcpServers (mcp-registry.ts),
    // correctly so — a custom entry must not impersonate a built-in proxy.
    // AT_DRIVER_* is the app-side terminal handoff: a loopback port and a
    // per-boot capability token, the same shape the browser entry carries.
    env: {
      AC_WORKSPACE: workspace,
      ...(terminalHandoff
        ? { AT_DRIVER_PORT: String(terminalHandoff.driverPort), AT_DRIVER_TOKEN: terminalHandoff.driverToken }
        : {}),
    },
    enabled: true,
  };
  // The browser entry carries the app-side driver handoff (loopback port,
  // capability token, session root — all paths/ports, never a credential).
  const browserDesired: Record<string, unknown> | null = browser && browser.driverPort > 0 && browser.driverToken
    ? {
        command: "/proc/self/exe",
        args: [browser.proxyPath],
        env: {
          AB_DRIVER_PORT: String(browser.driverPort),
          AB_DRIVER_TOKEN: browser.driverToken,
          AB_SESSIONS_ROOT: browser.sessionsRoot,
        },
        enabled: true,
      }
    : null;
  // The android_browser entry is app-owned: shape-recognized and managed
  // across boots — seeded, refreshed when the driver handoff rotates, and
  // removed when a build ships without the browser layer (a leftover entry
  // would make the harness spawn a bundle that no longer exists). A stored
  // entry with any other shape is the user's own and is left exactly as
  // configured, in both directions.
  const storedBrowser = mcpServers[ANDROID_BROWSER_SERVER_NAME];
  const browserIsOurs = (raw: unknown): boolean =>
    !!raw && typeof raw === "object" && !Array.isArray(raw) &&
    (raw as Record<string, unknown>).command === "/proc/self/exe";
  const browserSettled = browserDesired && browser
    ? storedBrowser !== undefined && browserIsOurs(storedBrowser) &&
      browserEntryMatches(storedBrowser, browser)
    : !browserIsOurs(storedBrowser);
  if (entryMatches(mcpServers[ANDROID_COMPUTER_SERVER_NAME], proxyPath, workspace, terminal) && browserSettled) {
    return "current";
  }
  const candidate: Record<string, unknown> = {
    ...mcpServers,
    [ANDROID_COMPUTER_SERVER_NAME]: desired,
  };
  if (browserDesired && (storedBrowser === undefined || browserIsOurs(storedBrowser))) {
    candidate[ANDROID_BROWSER_SERVER_NAME] = browserDesired;
  } else if (!browserDesired && browserIsOurs(storedBrowser)) {
    delete candidate[ANDROID_BROWSER_SERVER_NAME];
  }
  // Validate through the exact upstream parser before writing: if our entry
  // or an existing one is malformed, do not corrupt the user's config.
  for (const [name, raw] of Object.entries(candidate)) {
    const parsed = parseStoredMcpServer(name, raw);
    if (!parsed.ok) {
      log(`android-seed: mcpServers entry ${name} invalid (${parsed.error}); leaving config untouched`);
      return "skipped";
    }
  }
  writeFileSync(configPath, JSON.stringify({ ...config, mcpServers: candidate }, null, 2));
  const browserNote = browserDesired
    ? ` + ${ANDROID_BROWSER_SERVER_NAME}`
    : browserIsOurs(storedBrowser)
    ? ` - ${ANDROID_BROWSER_SERVER_NAME} (stale)`
    : "";
  log(`android-seed: ${ANDROID_COMPUTER_SERVER_NAME}${browserNote} MCP server ${mcpServers[ANDROID_COMPUTER_SERVER_NAME] ? "updated" : "added"} in config.json`);
  return "written";
}
