// Android entry point for the OpenMausBot harness server.
//
// Phase 4 seam, nothing more: before the real server module loads (its module
// level reads config exactly once, `const cfg = loadConfig()`), seed the
// android_computer MCP server into config.json so the ordinary turn pipeline
// mounts the Android computer adapter for engines that speak custom MCP.
// Everything else — server behavior, contracts, shutdown — is upstream's
// index.ts, unchanged.
import { dirname } from "node:path";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedAndroidComputerServer } from "./android-seed.ts";

const SERVER_ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.OMB_DATA_DIR ?? join("/data", "data");
// The sandbox root has exactly one owner: the Android harness (HarnessHost.kt),
// which passes AC_WORKSPACE. The server never invents one — a silently
// different fallback path would fork the workspace into two roots.
const WORKSPACE = process.env.AC_WORKSPACE;
// Phase 7: the app-side WebView driver hands its loopback port + capability
// token through the same env. Port 0 / missing token means the build or boot
// has no browser layer — seed nothing and say so once.
const BROWSER_DRIVER_PORT = Number(process.env.AB_DRIVER_PORT ?? "0");
const BROWSER_DRIVER_TOKEN = process.env.AB_DRIVER_TOKEN ?? "";
const BROWSER_SESSIONS_ROOT = process.env.AB_SESSIONS_ROOT ?? "";
// Phase 8: same handoff for the terminals. The tools that use them live in the
// android_computer adapter (unlike the browser's separate server), so these go
// into that entry's env. Port 0 / no token means no terminal layer on this
// boot and the adapter keeps its structural refusal.
const TERMINAL_DRIVER_PORT = Number(process.env.AT_DRIVER_PORT ?? "0");
const TERMINAL_DRIVER_TOKEN = process.env.AT_DRIVER_TOKEN ?? "";
if (!WORKSPACE) {
  console.error("[android] AC_WORKSPACE is not set — the harness must provide the sandbox root; refusing to seed the computer adapter");
} else {
  const browser = BROWSER_DRIVER_PORT > 0 && BROWSER_DRIVER_TOKEN && BROWSER_SESSIONS_ROOT
    ? { proxyPath: resolve(join(SERVER_ROOT, "android-browser.js")), driverPort: BROWSER_DRIVER_PORT, driverToken: BROWSER_DRIVER_TOKEN, sessionsRoot: BROWSER_SESSIONS_ROOT }
    : undefined;
  const terminal = TERMINAL_DRIVER_PORT > 0 && TERMINAL_DRIVER_TOKEN
    ? { driverPort: TERMINAL_DRIVER_PORT, driverToken: TERMINAL_DRIVER_TOKEN }
    : undefined;
  const seeded = seedAndroidComputerServer({
    dataDir: DATA_DIR,
    proxyPath: resolve(join(SERVER_ROOT, "android-computer.js")),
    workspace: WORKSPACE,
    ...(browser ? { browser } : {}),
    ...(terminal ? { terminal } : {}),
    log: (message) => console.log(`[android] ${message}`),
  });
  if (seeded === "written") {
    // Expose the workspace dir for diagnostics; the value is a path, not a secret.
    console.log(`[android] workspace sandbox: ${WORKSPACE}`);
    if (browser) console.log(`[android] browser layer: android_browser seeded (driver on loopback :${BROWSER_DRIVER_PORT})`);
    else console.log("[android] browser layer: not seeded (no driver handoff in env)");
    if (terminal) console.log(`[android] terminal layer: persistent terminals available (driver on loopback :${TERMINAL_DRIVER_PORT})`);
    else console.log("[android] terminal layer: not available (no driver handoff in env)");
  }
}

await import("./index.js");
