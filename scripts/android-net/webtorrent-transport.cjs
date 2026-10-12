#!/usr/bin/env node
// WebTorrent's own transports, exercised on the phone.
//
//   <libnode_host.so> webtorrent-transport.cjs <.../torlnk/node_modules>
//
// Two things this cannot fake:
//
//   WT_WEBRTC_SUPPORT  WebTorrent sets this at module load from simple-peer's
//                      own check, and simple-peer's lite.js gets it from
//                      webrtc-polyfill, whose module body eagerly imports
//                      node-datachannel. With the addon missing, importing
//                      webtorrent/index.js throws at all.
//   the uTP swarm     A real seeder and a real leecher in one process: the
//                      leecher is told to connect to 127.0.0.1, which makes
//                      WebTorrent choose a uTP outgoing wire (lib/torrent.js:
//                      `client.utp && isIPv4(host) ? 'utp' : 'tcp'`), and the
//                      wire reports its own type — bittorrent-protocol stores
//                      the connection type the peer handed it. A TCP fallback
//                      would show up as tcpOutgoing, which fails this.
//
// The payload is only as good as the bytes: the download is hashed against the
// seeded content before anything is called verified.

"use strict";

const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

const tree = process.argv[2];
if (!tree) {
  console.error("usage: webtorrent-transport.cjs <.../node_modules>");
  process.exit(2);
}

const failures = [];
const line = (key, value) => console.log(`WT_${key} ${value}`);
function pass(name, detail) {
  console.log(`ok   ${name}${detail ? `: ${detail}` : ""}`);
}
function fail(name, detail) {
  failures.push(name);
  console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
}

function version(pkg) {
  try {
    return JSON.parse(readFileSync(join(tree, pkg, "package.json"), "utf8")).version;
  } catch {
    return "absent";
  }
}

/** Resolve when the emitter fires [event], or reject at the deadline. */
function once(emitter, event, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    emitter.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

function finish() {
  const verdict = failures.length ? `fail (${failures.join("; ")})` : "pass";
  line("RESULT", verdict);
  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
  process.exit(failures.length ? 1 : 0);
}

const hardStop = setTimeout(() => {
  fail("the whole scenario finished in time", "60s deadline");
  line("RESULT", "fail (deadline)");
  console.log("\n1 check(s) failed");
  process.exit(1);
}, 60_000);
hardStop.unref?.();

async function utpSwarm(WebTorrent) {
  const payload = Buffer.alloc(256 * 1024);
  for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 31 + 7) & 0xff;
  const expected = createHash("sha256").update(payload).digest("hex");

  // Where the store writes, and why it is explicit: WebTorrent resolves its
  // default store path once at module load (lib/torrent.js: `TMP =
  // path.join(fs.statSync('/tmp') && '/tmp', 'webtorrent')`). Android has a
  // /tmp that exists and is NOT writable, so the default makes every piece
  // read fail with EACCES, and TMPDIR cannot change that. torlnk passes
  // `{ path }` on every add, which is what this does too.
  const workDir = mkdtempSync(join(process.cwd(), "omb-webtorrent-"));
  line("STORE_DIR", workDir);
  line("OS_TMPDIR", `${tmpdir()} exists=${existsSync("/tmp")} writable=${tmpWritable()}`);

  // Loopback only: no DHT, no trackers, no LSD, no UPnP/PMP discovery. The two
  // clients find each other because this script tells the leecher exactly where
  // the seeder listens.
  const options = { utp: true, dht: false, tracker: false, lsd: false, natUpnp: false, natPmp: false };
  const seeder = new WebTorrent(options);
  const leecher = new WebTorrent(options);
  const wireTypes = new Set();

  try {
    const seeded = seeder.seed(payload, { name: "omb-utp-payload.bin", path: workDir });
    seeded.on("wire", (wire) => wireTypes.add(`seed:${wire.type}`));

    await once(seeder, "listening", 15_000);
    line("LISTENING_PORT", String(seeder.torrentPort));
    if (!seeder.torrentPort) throw new Error("the seeder never reported a listening port");

    const downloading = leecher.add(seeded.magnetURI, { path: workDir });
    downloading.on("wire", (wire) => wireTypes.add(`leech:${wire.type}`));

    // addPeer() refuses before the info hash is known; for a magnet that
    // arrives as an event, so it is awaited rather than assumed.
    if (!downloading.infoHash) await once(downloading, "infoHash", 15_000);
    downloading.addPeer(`127.0.0.1:${seeder.torrentPort}`);

    if (!downloading.done) await once(downloading, "done", 40_000);
    line("PROGRESS", String(downloading.progress));

    const received = Buffer.from(await downloading.files[0].arrayBuffer());
    const got = createHash("sha256").update(received).digest("hex");
    line("PAYLOAD_BYTES", String(received.length));
    line("PAYLOAD_MATCH", String(got === expected));
    line("WIRES", [...wireTypes].sort().join(","));

    if (got === expected) pass("the whole file arrived", `${received.length} bytes, sha256 ${got.slice(0, 16)}…`);
    else fail("the whole file arrived", `${received.length} bytes, sha256 ${got}`);

    const utpWires = [...wireTypes].filter((entry) => entry.includes("utp"));
    if (utpWires.length === 0) fail("the transfer ran over a uTP wire", `wires seen: ${[...wireTypes].join(",") || "none"}`);
    else pass("the transfer ran over a uTP wire", utpWires.join(" "));
    if ([...wireTypes].some((entry) => entry.includes("tcp"))) {
      fail("no TCP wire was involved", [...wireTypes].join(","));
    }
  } finally {
    await Promise.all([seeder.destroy(), leecher.destroy()]);
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Whether os.tmpdir() can actually be written to on this device. */
function tmpWritable() {
  const probe = join(tmpdir(), `omb-wt-probe-${process.pid}`);
  try {
    mkdirSync(probe, { recursive: true });
    rmSync(probe, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let WebTorrent = null;
  try {
    WebTorrent = (await import(pathToFileURL(join(tree, "webtorrent", "index.js")).href)).default;
  } catch (error) {
    line("WEBRTC_SUPPORT", "absent");
    line("IMPORT", `threw:${(error && error.code) || (error && error.message) || error}`);
    fail("webtorrent imports", (error && error.code) || String(error));
    clearTimeout(hardStop);
    finish();
    return;
  }

  line("IMPORT", "ok");
  line("VERSION", version("webtorrent"));
  line("WEBRTC_SUPPORT", String(WebTorrent.WEBRTC_SUPPORT));
  if (WebTorrent.WEBRTC_SUPPORT === true) {
    pass("WebTorrent reports WebRTC support", "WEBRTC_SUPPORT true");
  } else {
    fail("WebTorrent reports WebRTC support", `WEBRTC_SUPPORT is ${WebTorrent.WEBRTC_SUPPORT}`);
  }

  await utpSwarm(WebTorrent);
  clearTimeout(hardStop);
  finish();
}

main().catch((error) => {
  fail("the scenario ran", error && error.message ? error.message : String(error));
  clearTimeout(hardStop);
  finish();
});
