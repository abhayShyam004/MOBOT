#!/usr/bin/env node
// What the installed packages themselves report about WebRTC and uTP.
//
//   <libnode_host.so> capability-detection.cjs <.../torlnk/node_modules>
//
// Every line here is read out of somebody else's code, never decided here:
//
//   TORLNK_PROBE       torlnk/dist/cli.cjs's own check, `require("node-datachannel")`
//   POLYFILL           importing webrtc-polyfill, whose module body eagerly
//                      destructures { PeerConnection, RtcpReceivingSession,
//                      Video, Audio, cleanup } out of node-datachannel
//   RTCPeerConnection  typeof webrtc-polyfill's default export — with torlnk's
//                      stub in play this is "undefined", which is exactly the
//                      condition that makes simple-peer report no WebRTC
//   UTP_KEYS           webtorrent/lib/utp.cjs's `Object.keys(utp).length`
//   UTP_SUPPORT        webtorrent's ConnPool.UTP_SUPPORT, which is that count > 0
//
// So a "true"/"loaded" here cannot be produced by a flag: it only happens when
// a real addon loads in this process. The harness runs this twice — once as the
// app leaves it, once with the addons hidden — because a capability report that
// cannot say "no" is not a report.

const { createRequire } = require("node:module");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

const tree = process.argv[2];
if (!tree) {
  console.error("usage: capability-detection.cjs <.../node_modules>");
  process.exit(2);
}

// A require anchored inside the installed tree, so bare specifiers resolve the
// way they do for torlnk itself rather than relative to this file.
const anchored = createRequire(join(tree, "index.js"));
const line = (key, value) => console.log(`CAPABILITY_${key} ${value}`);

// Read the manifest directly: packages here restrict their `exports` maps, so
// `require("<name>/package.json")` is refused even though the file is right
// there.
function version(pkg) {
  try {
    return JSON.parse(readFileSync(join(tree, pkg, "package.json"), "utf8")).version;
  } catch {
    return "absent";
  }
}

async function main() {
  console.log(`CAPABILITY_TREE ${tree}`);

  // 1. torlnk's own probe.
  let nd = null;
  try {
    nd = anchored("node-datachannel");
    line("TORLNK_PROBE", "loaded");
    line("LIBDATACHANNEL", typeof nd.getLibraryVersion === "function" ? nd.getLibraryVersion() : "unknown");
  } catch (error) {
    line("TORLNK_PROBE", `threw:${(error && error.code) || (error && error.message) || error}`);
    line("LIBDATACHANNEL", "absent");
  }

  // 2. the eager import the whole WebRTC chain depends on. Imported by path:
  // webrtc-polyfill's exports map is import-only (node → ./index.js), which
  // the ESM loader in torlnk's own `import('./index.js').catch(...)` honours
  // exactly the same way.
  try {
    const polyfill = await import(pathToFileURL(join(tree, "webrtc-polyfill", "index.js")).href);
    line("POLYFILL", "ok");
    // RTCPeerConnection is a named export; the default export is the module's
    // own namespace object, so it is never the constructor itself.
    const ctor = polyfill.RTCPeerConnection ?? polyfill.default?.RTCPeerConnection;
    line("RTCPeerConnection", typeof ctor);
    line("POLYFILL_VERSION", version("webrtc-polyfill"));
  } catch (error) {
    line("POLYFILL", `threw:${(error && error.code) || (error && error.message) || error}`);
    line("RTCPeerConnection", "undefined");
  }

  // 3. WebTorrent's own uTP check, then the module that computes it at load.
  try {
    const utp = anchored("webtorrent/lib/utp.cjs");
    line("UTP_KEYS", String(Object.keys(utp).length));
    line("UTP_CREATESERVER", typeof utp.createServer);
  } catch (error) {
    line("UTP_KEYS", `threw:${(error && error.code) || (error && error.message) || error}`);
  }
  try {
    const connPool = await import(pathToFileURL(anchored.resolve("webtorrent/lib/conn-pool.js")).href);
    line("UTP_SUPPORT", String(Boolean(connPool.default.UTP_SUPPORT)));
    line("WEBTORRENT", version("webtorrent"));
  } catch (error) {
    line("UTP_SUPPORT", `threw:${(error && error.code) || (error && error.message) || error}`);
  }

  line("TORLNK", version("torlnk"));
  line(
    "DISABLE_FLAGS",
    ["TORLINK_NO_WEBRTC", "TORLINK_NO_UTP"].filter((name) => process.env[name]).join(",") || "none",
  );
  line("ADDON_PRESENT", String(existsSync(join(tree, "node-datachannel", "build", "Release", "node_datachannel.node"))));
  line("UTP_ADDON_PRESENT", String(existsSync(join(tree, "utp-native", "build", "Release", "utp_native.node"))));

  if (nd && typeof nd.cleanup === "function") {
    try { nd.cleanup(); } catch { /* nothing to clean */ }
  }
}

main().catch((error) => {
  console.log(`CAPABILITY_ERROR ${error && error.message ? error.message : error}`);
  process.exit(1);
});
