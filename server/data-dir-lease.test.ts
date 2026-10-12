import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { acquireDataDirLease } from "./data-dir-lease.ts";

const MODULE_URL = pathToFileURL(join(process.cwd(), "server", "data-dir-lease.ts")).href;
const dirs: string[] = [];

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-data-dir-lease-"));
  dirs.push(dir);
  return dir;
}

function leaseWorker(source: string, environment: Record<string, string> = {}) {
  const child = spawn(process.execPath, [
    "--no-warnings",
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    source,
  ], { env: { ...process.env, ...environment }, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  return {
    child,
    lines: createInterface({ input: child.stdout })[Symbol.asyncIterator](),
    exited: once(child, "exit"),
    stderr: () => stderr,
  };
}

async function workerLine(worker: ReturnType<typeof leaseWorker>): Promise<string> {
  const line = await worker.lines.next();
  if (line.done) throw new Error(`lease worker exited before replying: ${worker.stderr()}`);
  return line.value;
}

async function expectCleanExit(worker: ReturnType<typeof leaseWorker>): Promise<void> {
  const [code, signal] = await worker.exited;
  expect({ code, signal, stderr: worker.stderr() }).toEqual({ code: 0, signal: null, stderr: "" });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("OpenMausBot data-directory lease", () => {
  it("holds one directory until its matching handle releases it", () => {
    const dir = tempDataDir();
    const lease = acquireDataDirLease(dir);
    const stored = JSON.parse(readFileSync(join(dir, "openmausbot-server.lease"), "utf8"));

    // boot/uptime identify which boot wrote the record, so a pid recycled
    // across a restart cannot be mistaken for a live owner. boot is null on
    // platforms that expose no boot id, so it is checked separately.
    const { boot, ...rest } = stored;
    expect(rest).toEqual({
      version: 1,
      pid: process.pid,
      host: hostname(),
      token: expect.stringMatching(/^[0-9a-f-]{36}$/),
      createdAt: expect.any(Number),
      uptime: expect.any(Number),
    });
    expect(boot === null || (typeof boot === "string" && boot.length > 0)).toBe(true);
    expect(Object.keys(stored).sort()).toEqual(
      ["boot", "createdAt", "host", "pid", "token", "uptime", "version"],
    );
    expect(() => acquireDataDirLease(dir)).toThrow(/already using this data directory/i);

    expect(lease.release()).toBe(true);
    expect(lease.release()).toBe(false);
    const replacement = acquireDataDirLease(dir);
    expect(replacement.release()).toBe(true);
  });

  it("will not release a lease whose owner token changed", () => {
    const dir = tempDataDir();
    const path = join(dir, "openmausbot-server.lease");
    const lease = acquireDataDirLease(dir);
    const original = JSON.parse(readFileSync(path, "utf8"));
    const replacement = { ...original, token: randomUUID() };
    unlinkSync(path);
    writeFileSync(path, `${JSON.stringify(replacement)}\n`, { mode: 0o600 });

    expect(() => lease.release()).toThrow(/will not release.*another process/i);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(replacement);
  });

  it("allows only one live child process to own a shared directory", async () => {
    const dir = tempDataDir();
    const holderSource = `
      const { acquireDataDirLease } = await import(${JSON.stringify(MODULE_URL)});
      const lease = acquireDataDirLease(${JSON.stringify(dir)});
      process.stdout.write("acquired\\n");
      process.stdin.once("data", () => {
        lease.release();
        process.stdout.write("released\\n");
      });
    `;
    const holder = leaseWorker(holderSource);
    try {
      expect(await workerLine(holder)).toBe("acquired");
      const contender = leaseWorker(`
        const { acquireDataDirLease } = await import(${JSON.stringify(MODULE_URL)});
        try {
          acquireDataDirLease(${JSON.stringify(dir)});
          process.stdout.write(JSON.stringify({ acquired: true }) + "\\n");
        } catch (error) {
          process.stdout.write(JSON.stringify({ error: String(error?.message ?? error) }) + "\\n");
        }
      `);
      const result = JSON.parse(await workerLine(contender));
      await expectCleanExit(contender);
      expect(result.error).toMatch(/already using this data directory.*process/i);

      holder.child.stdin.end("release\n");
      expect(await workerLine(holder)).toBe("released");
      await expectCleanExit(holder);
      const after = acquireDataDirLease(dir);
      expect(after.release()).toBe(true);
    } finally {
      if (holder.child.exitCode === null) holder.child.kill("SIGKILL");
    }
  });

  it("recovers the complete lease left by a crashed child", async () => {
    const dir = tempDataDir();
    const crashed = leaseWorker(`
      const { acquireDataDirLease } = await import(${JSON.stringify(MODULE_URL)});
      acquireDataDirLease(${JSON.stringify(dir)});
      process.stdout.write("acquired\\n");
      process.exit(0);
    `);
    expect(await workerLine(crashed)).toBe("acquired");
    await expectCleanExit(crashed);

    const recovered = acquireDataDirLease(dir);
    expect(recovered.ownerPid).toBe(process.pid);
    expect(recovered.release()).toBe(true);
  });

  it("fails closed on a corrupt owner record", () => {
    const dir = tempDataDir();
    const path = join(dir, "openmausbot-server.lease");
    writeFileSync(path, "not-json\n", { mode: 0o600 });

    expect(() => acquireDataDirLease(dir)).toThrow(/lease is invalid.*refusing to start/i);
    expect(readFileSync(path, "utf8")).toBe("not-json\n");
  });
});

describe("OpenMausBot data-directory lease on platforms without hard links (Android)", () => {
  const FORCED = { OPENMAUSBOT_LEASE_FORCE_SYMLINK: "1" };
  const previousForced = process.env.OPENMAUSBOT_LEASE_FORCE_SYMLINK;

  // The in-process acquisitions below must exercise the same publication
  // route their spawned workers use.
  beforeAll(() => {
    process.env.OPENMAUSBOT_LEASE_FORCE_SYMLINK = "1";
  });
  afterAll(() => {
    if (previousForced === undefined) delete process.env.OPENMAUSBOT_LEASE_FORCE_SYMLINK;
    else process.env.OPENMAUSBOT_LEASE_FORCE_SYMLINK = previousForced;
  });

  function symlinkFacts(dir: string) {
    const leasePath = join(dir, "openmausbot-server.lease");
    const target = readlinkSync(leasePath);
    expect(target).toMatch(/^openmausbot-server\.lease\.payload-/);
    const payloadPath = join(dir, target);
    const stored = JSON.parse(readFileSync(payloadPath, "utf8"));
    return { leasePath, target, payloadPath, stored };
  }

  function acquireSource(dir: string) {
    return `
      const { acquireDataDirLease } = await import(${JSON.stringify(MODULE_URL)});
      try {
        const lease = acquireDataDirLease(${JSON.stringify(dir)});
        process.stdout.write(JSON.stringify({ ok: true, ownerPid: lease.ownerPid }) + "\\n");
        process.stdin.once("data", () => {
          lease.release();
          process.stdout.write("released\\n");
        });
      } catch (error) {
        process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message ?? error) }) + "\\n");
      }
    `;
  }

  it("publishes a complete record atomically on first startup", async () => {
    const dir = tempDataDir();
    const first = leaseWorker(acquireSource(dir), FORCED);
    expect(await workerLine(first)).toBe(JSON.stringify({ ok: true, ownerPid: first.child.pid }));

    const { stored } = symlinkFacts(dir);
    // The payload carries the same validated record the hard-link path writes.
    expect(stored.version).toBe(1);
    expect(stored.pid).toBe(first.child.pid);
    expect(stored.host).toBe(hostname());
    expect(stored.token).toMatch(/^[0-9a-f-]{36}$/);
    // The publish payload is complete before the lease name exists, and the
    // candidate is gone: readers can only ever observe a whole record.
    expect(existsSync(join(dir, `openmausbot-server.lease.candidate-${stored.pid}-${stored.token}`))).toBe(false);

    first.child.stdin.end("release\n");
    expect(await workerLine(first)).toBe("released");
    await expectCleanExit(first);
  });

  it("refuses a second startup against the same data directory, then admits it after release", async () => {
    const dir = tempDataDir();
    const holder = leaseWorker(acquireSource(dir), FORCED);
    expect(await workerLine(holder)).toBe(JSON.stringify({ ok: true, ownerPid: holder.child.pid }));

    const contender = leaseWorker(acquireSource(dir), FORCED);
    const result = JSON.parse(await workerLine(contender));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already using this data directory.*process/i);
    contender.child.stdin.end();
    await expectCleanExit(contender);

    holder.child.stdin.end("release\n");
    expect(await workerLine(holder)).toBe("released");
    await expectCleanExit(holder);

    const after = leaseWorker(acquireSource(dir), FORCED);
    expect(await workerLine(after)).toBe(JSON.stringify({ ok: true, ownerPid: after.child.pid }));
    after.child.kill("SIGKILL");
  });

  it("recovers the stale lease and payload of a crashed owner", async () => {
    const dir = tempDataDir();
    const crashed = leaseWorker(acquireSource(dir), FORCED);
    const acquired = JSON.parse(await workerLine(crashed));
    expect(acquired.ok).toBe(true);
    const { payloadPath } = symlinkFacts(dir);
    crashed.child.kill("SIGKILL");
    await once(crashed.child, "close");
    // The crashed owner leaves both the lease name and its payload behind.
    expect(existsSync(payloadPath)).toBe(true);

    const recovered = acquireDataDirLease(dir);
    expect(recovered.ownerPid).toBe(process.pid);
    expect(recovered.release()).toBe(true);
  });

  it("elects exactly one owner when several processes race to start", async () => {
    const dir = tempDataDir();
    const contenders = Array.from({ length: 6 }, () =>
      leaseWorker(acquireSource(dir), FORCED),
    );
    const outcomes = await Promise.all(
      contenders.map(async (worker) => JSON.parse(await workerLine(worker))),
    );

    const winnerIndex = outcomes.findIndex((outcome) => outcome.ok);
    const winners = outcomes.filter((outcome) => outcome.ok);
    const losers = outcomes.filter((outcome) => !outcome.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(5);
    expect(winners[0].ownerPid).toBe(contenders[winnerIndex].child.pid);
    for (const loser of losers) {
      expect(loser.error).toMatch(/already using this data directory/i);
    }

    // Losers register no stdin listener, so they exit on their own.
    contenders[winnerIndex].child.stdin.end("release\n");
    expect(await workerLine(contenders[winnerIndex])).toBe("released");
    await Promise.all(contenders.map((worker) => expectCleanExit(worker)));

    // The winner's payload is reclaimed on release; nobody else left anything.
    expect(readdirSync(dir).filter((name) => name.includes("candidate-") || name.includes(".payload-")))
      .toEqual([]);
    const after = acquireDataDirLease(dir);
    expect(after.release()).toBe(true);
  });

  it("releases cleanly and restarts with a fresh record", async () => {
    const dir = tempDataDir();
    const first = acquireDataDirLease(dir);
    const { leasePath, payloadPath, stored } = symlinkFacts(dir);
    expect(lstatSync(leasePath).isSymbolicLink()).toBe(true);

    expect(first.release()).toBe(true);
    expect(existsSync(leasePath)).toBe(false);
    expect(existsSync(payloadPath)).toBe(false);

    const second = acquireDataDirLease(dir);
    const replaced = symlinkFacts(dir);
    expect(replaced.stored.token).not.toBe(stored.token);
    expect(second.release()).toBe(true);
  });

  it("retires a dangling symlink lease whose payload was lost, without touching a live one", () => {
    const dir = tempDataDir();
    const leasePath = join(dir, "openmausbot-server.lease");
    // Reconstruct exactly what a crash between payload loss and name removal
    // leaves behind: a lease name resolving to a vanished payload.
    const payloadPath = `${leasePath}.payload-1-00000000-0000-4000-8000-000000000000`;
    writeFileSync(payloadPath, "{}\n", { mode: 0o600 });
    symlinkSync(basename(payloadPath), leasePath);
    unlinkSync(payloadPath);

    const acquired = acquireDataDirLease(dir);
    expect(acquired.ownerPid).toBe(process.pid);
    const { stored } = symlinkFacts(dir);
    expect(stored.pid).toBe(process.pid);
    acquired.release();

    // A live lease (readable through its payload) is never retired this way.
    const live = acquireDataDirLease(dir);
    expect(() => acquireDataDirLease(dir)).toThrow(/already using this data directory/i);
    expect(lstatSync(leasePath).isSymbolicLink()).toBe(true);
    live.release();
  });
});
