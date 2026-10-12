import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANDROID_BROWSER_SERVER_NAME,
  browserEntryMatches,
  entryMatches,
  seedAndroidComputerServer,
} from "./android-seed.ts";

// Phase 7: the android_browser seeding rides the same boot call as
// android_computer, so every contract below pins the combined behavior —
// including the no-browser-layer builds that must stay browser-free.
describe("seedAndroidComputerServer — android_browser entry", () => {
  let dataDir: string;
  const proxyPath = "/data/user/0/com.openmausbot.companion/files/host-server/android-computer.js";
  const workspace = "/data/user/0/com.openmausbot.companion/files/workspace";
  const browser = {
    proxyPath: "/data/user/0/com.openmausbot.companion/files/host-server/android-browser.js",
    driverPort: 18901,
    driverToken: "tok-abc123",
    sessionsRoot: "/data/user/0/com.openmausbot.companion/files/browser-sessions",
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "omb-seed-browser-"));
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it("seeds both entries when the browser layer is present", () => {
    expect(seedAndroidComputerServer({ dataDir, proxyPath, workspace, browser })).toBe("written");
    const entry = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")).mcpServers[
      ANDROID_BROWSER_SERVER_NAME
    ];
    expect(entry.command).toBe("/proc/self/exe");
    expect(entry.args).toEqual([browser.proxyPath]);
    expect(entry.env).toEqual({
      AB_DRIVER_PORT: String(browser.driverPort),
      AB_DRIVER_TOKEN: browser.driverToken,
      AB_SESSIONS_ROOT: browser.sessionsRoot,
    });
    expect(entry.enabled).toBe(true);
  });

  it("is idempotent with the browser layer present", () => {
    seedAndroidComputerServer({ dataDir, proxyPath, workspace, browser });
    const before = readFileSync(join(dataDir, "config.json"), "utf8");
    expect(seedAndroidComputerServer({ dataDir, proxyPath, workspace, browser })).toBe("current");
    expect(readFileSync(join(dataDir, "config.json"), "utf8")).toBe(before);
  });

  it("rewrites a stale browser entry (driver port rotated between boots)", () => {
    seedAndroidComputerServer({ dataDir, proxyPath, workspace, browser });
    const rotated = { ...browser, driverPort: browser.driverPort + 1 };
    expect(seedAndroidComputerServer({ dataDir, proxyPath, workspace, browser: rotated })).toBe(
      "written",
    );
    const entry = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")).mcpServers[
      ANDROID_BROWSER_SERVER_NAME
    ];
    expect(entry.env.AB_DRIVER_PORT).toBe(String(rotated.driverPort));
  });

  it("seeds no browser entry when the build has no browser layer", () => {
    expect(seedAndroidComputerServer({ dataDir, proxyPath, workspace })).toBe("written");
    const servers = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")).mcpServers;
    expect(servers[ANDROID_BROWSER_SERVER_NAME]).toBeUndefined();
    expect(servers.android_computer).toBeDefined();
  });

  it("drops a browser entry that no longer matches the boot handoff", () => {
    seedAndroidComputerServer({ dataDir, proxyPath, workspace, browser });
    expect(seedAndroidComputerServer({ dataDir, proxyPath, workspace })).toBe("written");
    const servers = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")).mcpServers;
    expect(servers[ANDROID_BROWSER_SERVER_NAME]).toBeUndefined();
  });

  it("never touches a user-configured entry named android_browser", () => {
    const userEntry = { command: "my-browser-bridge", args: ["--manual"], enabled: true };
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({ mcpServers: { [ANDROID_BROWSER_SERVER_NAME]: userEntry } }),
    );
    seedAndroidComputerServer({ dataDir, proxyPath, workspace, browser });
    const servers = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")).mcpServers;
    // The seeding writes only android_computer (and never user entries).
    expect(servers[ANDROID_BROWSER_SERVER_NAME]).toEqual(userEntry);
  });

  it("browserEntryMatches accepts exactly the seeded shape", () => {
    const good = {
      command: "/proc/self/exe",
      args: [browser.proxyPath],
      env: {
        AB_DRIVER_PORT: String(browser.driverPort),
        AB_DRIVER_TOKEN: browser.driverToken,
        AB_SESSIONS_ROOT: browser.sessionsRoot,
      },
      enabled: true,
    };
    expect(browserEntryMatches(good, browser)).toBe(true);
    expect(browserEntryMatches({ ...good, enabled: false }, browser)).toBe(false);
    expect(browserEntryMatches({ ...good, env: { ...good.env, AB_DRIVER_TOKEN: "nope" } }, browser)).toBe(
      false,
    );
    expect(browserEntryMatches(null, browser)).toBe(false);
  });
});

// Phase 8: the terminal handoff rides the android_computer entry itself (the
// terminal_* tools live in that adapter), so what is pinned here is that the
// entry is rewritten when the driver rotates and cleaned when the layer is
// gone — the same discipline the browser entry follows.
describe("seedAndroidComputerServer — terminal handoff", () => {
  let dataDir: string;
  const proxyPath = "/data/user/0/com.openmausbot.companion/files/host-server/android-computer.js";
  const workspace = "/data/user/0/com.openmausbot.companion/files/workspace";
  const terminal = { driverPort: 18911, driverToken: "term-token-xyz" };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "omb-seed-terminal-"));
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  function entry(): Record<string, any> {
    return JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")).mcpServers.android_computer;
  }

  it("seeds the driver handoff onto the android_computer entry", () => {
    expect(seedAndroidComputerServer({ dataDir, proxyPath, workspace, terminal })).toBe("written");
    expect(entry().env).toEqual({
      AC_WORKSPACE: workspace,
      AT_DRIVER_PORT: String(terminal.driverPort),
      AT_DRIVER_TOKEN: terminal.driverToken,
    });
  });

  it("is idempotent while the handoff is unchanged", () => {
    seedAndroidComputerServer({ dataDir, proxyPath, workspace, terminal });
    const before = readFileSync(join(dataDir, "config.json"), "utf8");
    expect(seedAndroidComputerServer({ dataDir, proxyPath, workspace, terminal })).toBe("current");
    expect(readFileSync(join(dataDir, "config.json"), "utf8")).toBe(before);
  });

  it("rewrites a stale handoff when the driver rotates between boots", () => {
    seedAndroidComputerServer({ dataDir, proxyPath, workspace, terminal });
    const rotated = { driverPort: terminal.driverPort + 1, driverToken: "rotated-token" };
    expect(seedAndroidComputerServer({ dataDir, proxyPath, workspace, terminal: rotated })).toBe("written");
    expect(entry().env.AT_DRIVER_PORT).toBe(String(rotated.driverPort));
    expect(entry().env.AT_DRIVER_TOKEN).toBe("rotated-token");
  });

  it("removes the handoff on a boot that hosts no terminals", () => {
    seedAndroidComputerServer({ dataDir, proxyPath, workspace, terminal });
    expect(seedAndroidComputerServer({ dataDir, proxyPath, workspace })).toBe("written");
    expect(entry().env).toEqual({ AC_WORKSPACE: workspace });
    // Which is what entryMatches insists on, in both directions.
    expect(entryMatches(entry(), proxyPath, workspace, undefined)).toBe(true);
    expect(entryMatches(entry(), proxyPath, workspace, terminal)).toBe(false);
  });
});
