#!/usr/bin/env node
// Real WebRTC functional test for the embedded Android runtime.
//
//   <libnode_host.so> webrtc-functional.cjs <node-datachannel package dir>
//
// It loads the package exactly the way torlnk does — `require()` on the package
// root, which resolves to dist/cjs/lib/index.cjs and then to
// build/Release/node_datachannel.node — and then drives two PeerConnections
// against each other over the loopback interface. Nothing here is stubbed: the
// ICE agent picks a real candidate pair, DTLS does a real handshake (that is
// the OpenSSL the runtime already had in process), and SCTP carries a real data
// channel whose bytes are counted at both ends.
//
// Every check prints `ok`/`FAIL` and the process exits non-zero if any failed,
// so this is usable both by hand and as a device gate.

const assert = require("node:assert");
const path = require("node:path");

const pkgDir = process.argv[2];
if (!pkgDir) {
  console.error("usage: webrtc-functional.cjs <node-datachannel package dir>");
  process.exit(2);
}

const failures = [];
// Awaits the body, so an async check that rejects is a failure rather than an
// unhandled rejection the process could still exit 0 on.
async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`ok   ${name}${detail ? `: ${detail}` : ""}`);
  } catch (err) {
    failures.push(name);
    console.log(`FAIL ${name}: ${err && err.message ? err.message : err}`);
  }
}

// The names webrtc-polyfill 1.2.2 destructures at import time. A build missing
// any of them breaks the import outright rather than degrading gracefully, so
// they are the minimum honest surface.
const POLYFILL_IMPORTS = ["PeerConnection", "RtcpReceivingSession", "Video", "Audio", "cleanup"];

/** A candidate, as text. A real transport has a real address and port here. */
function describe(side) {
  if (!side) return "?";
  const address = side.address ?? side.addressType ?? "?";
  const port = side.port ?? "?";
  return `${side.type ?? "?"} ${address}:${port}`;
}

/**
 * Two peers, wired to each other through the library's own signalling
 * callbacks, with host candidates only: no STUN server and no internet, which
 * is what two phones on a LAN do. Resolves with what actually happened rather
 * than with a verdict, so the caller reports the transport, not a boolean.
 */
function loopbackRoundTrip(nd) {
  const payload = Buffer.from("openmausbot webrtc payload ".repeat(64));
  const result = {
    state: "timeout",
    opened: false,
    echoBytes: -1,
    payloadBytes: payload.length,
    pair: null,
    sent: 0,
    received: 0,
    error: null,
    sdpTypes: [],
    candidates: { a: 0, b: 0 },
  };

  const a = new nd.PeerConnection("openmausbot-a", { iceServers: [] });
  const b = new nd.PeerConnection("openmausbot-b", { iceServers: [] });

  // Signalling is reported, not assumed: an offer and an answer crossing here
  // is what makes the rest of this a peer connection rather than two objects.
  a.onLocalDescription((sdp, type) => { result.sdpTypes.push(`a:${type}`); b.setRemoteDescription(sdp, type); });
  b.onLocalDescription((sdp, type) => { result.sdpTypes.push(`b:${type}`); a.setRemoteDescription(sdp, type); });
  a.onLocalCandidate((candidate, mid) => { result.candidates.a += 1; b.addRemoteCandidate(candidate, mid); });
  b.onLocalCandidate((candidate, mid) => { result.candidates.b += 1; a.addRemoteCandidate(candidate, mid); });

  return new Promise((resolve) => {
    const settle = (state) => {
      clearTimeout(timer);
      result.state = state;
      result.pair = a.getSelectedCandidatePair();
      try { result.sent = a.bytesSent(); result.received = a.bytesReceived(); } catch { /* optional */ }
      try { a.close(); b.close(); } catch { /* already gone */ }
      resolve(result);
    };

    // A hung ICE attempt must not read as a slow success, so the timeout is
    // part of the verdict rather than a harness detail.
    const timer = setTimeout(() => settle("timeout"), 25000);

    b.onDataChannel((channel) => {
      result.opened = true;
      // sendMessage() takes a string and sendMessageBinary() takes a Buffer:
      // handing a Buffer to sendMessage() throws a TypeError, which would look
      // exactly like a dead transport. Bytes go out as bytes.
      channel.onMessage((data) => {
        const bytes = Buffer.from(data);
        result.echoBytes = bytes.length;
        try { channel.sendMessageBinary(bytes); } catch (err) { result.error = `echo: ${err.message}`; }
      });
      channel.onError((err) => { result.error = `remote channel: ${err}`; });
    });

    const channel = a.createDataChannel("checks");
    channel.onOpen(() => {
      try { channel.sendMessageBinary(payload); } catch (err) { result.error = `send: ${err.message}`; }
    });
    channel.onMessage(() => settle("answered"));
    channel.onError((err) => {
      result.error = `local channel: ${err}`;
      settle("channel-error");
    });
  });
}

async function main() {
  let nd = null;
  await check("require(node-datachannel) loads the native addon", () => {
    nd = require(pkgDir);
    return `${Object.keys(nd).length} exports`;
  });

  if (!nd) {
    console.log(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }

  await check("native library reports its version", () => `${nd.getLibraryVersion()}`);

  await check("exports the API webrtc-polyfill imports at module load", () => {
    const missing = POLYFILL_IMPORTS.filter((name) => nd[name] === undefined);
    assert.deepStrictEqual(missing, [], `missing: ${missing.join(", ")}`);
    return POLYFILL_IMPORTS.join(", ");
  });

  await check("the compiled addon is the binding that was loaded", () => {
    const binding = require.resolve(path.join(pkgDir, "build", "Release", "node_datachannel.node"));
    assert.ok(binding, "the .node file did not resolve");
    return binding.split(path.sep).slice(-3).join("/");
  });

  let trip = null;
  await check("data channel opens over a real ICE + DTLS + SCTP transport", async () => {
    trip = await loopbackRoundTrip(nd);
    assert.strictEqual(
      trip.state,
      "answered",
      `the handshake ended as ${trip.state}` +
        (trip.error ? ` (${trip.error})` : "") +
        (trip.opened ? "" : "; the remote peer never saw a data channel"),
    );
    const pair = trip.pair
      ? `${describe(trip.pair.local)} → ${describe(trip.pair.remote)}`
      : "candidate pair not reported";
    return pair;
  });

  if (trip) {
    console.log(`WEBRTC_SDP ${trip.sdpTypes.join(",")}`);
    console.log(`WEBRTC_CANDIDATES a=${trip.candidates.a} b=${trip.candidates.b}`);
  }

  if (trip && trip.state === "answered") {
    await check("the remote peer received and echoed the whole payload", () => {
      assert.strictEqual(trip.echoBytes, trip.payloadBytes, `echoed ${trip.echoBytes} of ${trip.payloadBytes} bytes`);
      return `${trip.echoBytes} bytes round-tripped`;
    });

    await check("bytes really crossed the transport in both directions", () => {
      assert.ok(trip.sent > 0, `bytesSent() was ${trip.sent}`);
      assert.ok(trip.received > 0, `bytesReceived() was ${trip.received}`);
      return `${trip.sent} sent, ${trip.received} received`;
    });
  }

  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
  try { nd.cleanup(); } catch { /* nothing left to clean */ }
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
