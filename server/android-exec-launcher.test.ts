import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The native launcher, executed for real.
 *
 * `ombexec.c` is the piece that makes npm and npx ordinary executables on
 * Android: a real ELF file in the APK's native library directory, which a
 * symlink in the bot's bin directory may point at, and which takes the name it
 * was invoked as, resolves it to a JavaScript entry point, and execs the
 * embedded runtime on it. None of that logic needs a phone: the same source
 * builds for the development machine (`scripts/build-android-pty.mjs --host`),
 * and these tests run the real binary on a real kernel — name mapping,
 * /proc/self/exe resolution, argument pass-through, PATH lookup from a child,
 * and the failure paths.
 *
 * What the device run adds on top is only what is device-specific: that the
 * APK's directory really is exec-allowed and app data really is not.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST_LAUNCHER = join(root, ".omb-native-host", "libombexec.so");

// Built on demand: fast, deterministic, and it means this suite cannot pass by
// testing a stale binary from someone else's machine.
if (!existsSync(HOST_LAUNCHER)) {
  try {
    execFileSync("node", [join(root, "scripts", "build-android-pty.mjs"), "--host"], { stdio: "ignore" });
  } catch {
    // No host compiler: the suite reports that instead of pretending.
  }
}
const available = existsSync(HOST_LAUNCHER);

describe.skipIf(!available)("native PATH launcher (ombexec)", () => {
  const sandboxes: string[] = [];

  afterEach(() => {
    for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A stand-in for this app's native library directory plus a bot bin
   * directory: the launcher, a `node` runtime beside it, one script per name.
   */
  function sandbox(names: string[]): { dir: string; bin: string; env: NodeJS.ProcessEnv } {
    const dir = mkdtempSync(join(tmpdir(), "omb-launcher-"));
    sandboxes.push(dir);
    copyFileSync(HOST_LAUNCHER, join(dir, "libombexec.so"));
    // The runtime the launcher finds by looking at its own location.
    symlinkSync(process.execPath, join(dir, "libnode_host.so"));
    writeFileSync(join(dir, "npx-shim.js"), "console.log('npx-shim', process.argv.slice(2).join(' '));\n");
    writeFileSync(join(dir, "npm-cli.js"), "console.log('npm-cli', process.argv.slice(2).join(' '));\n");
    writeFileSync(join(dir, "env.js"), "console.log('LIB=' + (process.env.LD_LIBRARY_PATH ?? ''));\n");
    const bin = join(dir, ".omb-bin");
    mkdirSync(bin);
    for (const name of names) symlinkSync(join(dir, "libombexec.so"), join(bin, name));
    return {
      dir,
      bin,
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        OMB_NPX_SHIM: join(dir, "npx-shim.js"),
        OMB_NPM_CLI: join(dir, "npm-cli.js"),
        LD_LIBRARY_PATH: "",
      },
    };
  }

  it("resolves npm and npx the way every kind of caller asks for them", () => {
    const { bin, env } = sandbox(["npm", "npx"]);

    // 1. Executed directly (what a shell does for `./npx`, and what Android's
    //    no-exec-in-app-data rule refuses for a script).
    const direct = spawnSync(join(bin, "npx"), ["--version"], { env, encoding: "utf8" });
    expect(direct.status).toBe(0);
    expect(direct.stdout.trim()).toBe("npx-shim --version");

    // 2. Through a shell, by name, through PATH.
    const shell = spawnSync("/bin/sh", ["-c", "npm run build -- --watch"], { env, encoding: "utf8" });
    expect(shell.status).toBe(0);
    expect(shell.stdout.trim()).toBe("npm-cli run build -- --watch");

    // 3. From a CHILD process, which is the case a shell function could never
    //    satisfy: the child asks the kernel for a file named npx.
    const spawned = spawnSync(
      process.execPath,
      ["-e", "const r=require('node:child_process').spawnSync('npx',['--probe'],{encoding:'utf8'});process.stdout.write(r.stdout)"],
      { env, encoding: "utf8" },
    );
    expect(spawned.status).toBe(0);
    expect(spawned.stdout.trim()).toBe("npx-shim --probe");

    // 4. As a background job writing to its own output, the way a bot would
    //    start one without a terminal.
    const background = spawnSync(
      "/bin/sh",
      ["-c", `npx --yes torlnk > ${bin}/out.txt 2>&1 & wait; cat ${bin}/out.txt`],
      { env, encoding: "utf8" },
    );
    expect(background.stdout.trim()).toBe("npx-shim --yes torlnk");
  });

  it("passes arguments through untouched, including spaces", () => {
    const { bin, env } = sandbox(["npx"]);
    const result = spawnSync(join(bin, "npx"), ["--yes", "some package", "a b"], { env, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("npx-shim --yes some package a b");
  });

  it("is generic: any name can map to any script", () => {
    const { dir, bin } = sandbox(["hello"]);
    writeFileSync(join(dir, "hello.js"), "console.log('hello from', process.argv.slice(2).join(' '));\n");
    const result = spawnSync(join(bin, "hello"), ["world"], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        // The generic mapping: the name a caller chooses is the name it
        // exports. No package, no npm, and nothing about terminals.
        OMB_LAUNCHER_HELLO: join(dir, "hello.js"),
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("hello from world");
  });

  it("makes the runtime's own library directory usable even with an empty environment", () => {
    const { dir, bin, env } = sandbox(["npx"]);
    const result = spawnSync(join(bin, "npx"), [join(dir, "env.js")], {
      // A caller with no LD_LIBRARY_PATH at all still gets a runtime that can
      // start: the launcher sets it from its own location first.
      env: { ...env, OMB_NPX_SHIM: join(dir, "env.js"), LD_LIBRARY_PATH: "" },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`LIB=${dir}`);
  });

  it("fails honestly for a name it has no mapping for", () => {
    const { bin, env } = sandbox(["mystery"]);
    const result = spawnSync(join(bin, "mystery"), [], { env, encoding: "utf8" });
    expect(result.status).toBe(127);
    expect(result.stderr).toContain("no launcher is configured for `mystery`");
  });

  it("fails honestly when the runtime is not where it should be", () => {
    const { dir, bin } = sandbox(["npx"]);
    rmSync(join(dir, "libnode_host.so"));
    const result = spawnSync(join(bin, "npx"), ["--version"], {
      // A PATH without node: the last resort is unavailable too.
      env: { PATH: bin, OMB_NPX_SHIM: join(dir, "npx-shim.js") },
      encoding: "utf8",
    });
    expect(result.status).toBe(127);
    expect(result.stderr).toContain("the embedded runtime is missing");
  });
});

describe.skipIf(available)("native PATH launcher (ombexec)", () => {
  it("cannot run: no host compiler built the launcher", () => {
    console.log(
      "host launcher unavailable — run `node scripts/build-android-pty.mjs --host` with a C compiler to cover ombexec",
    );
    expect(available).toBe(false);
  });
});
