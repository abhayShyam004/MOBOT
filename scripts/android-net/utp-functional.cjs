#!/usr/bin/env node
/*
 * uTP functional test — runs on the phone, inside the app's runtime.
 *
 * Not a smoke test of `require`: it creates real uTP sockets over UDP, moves
 * real bytes in both directions (including a payload far larger than a datagram
 * so libutp has to segment and reassemble it), closes them in an orderly way,
 * and checks that a connect to nothing fails *as a failure*. It prints one JSON
 * line so the runner can assert on facts instead of on log text.
 *
 *   node utp-functional.cjs <module-dir-or-name>
 *
 * `require()` resolves the module exactly the way the app's packages do, so a
 * pass means the same thing a torrent client would see.
 */
"use strict";

const target = process.argv[2] || "utp-native";

const result = {
  ok: false,
  module: target,
  resolvedFrom: null,
  api: {},
  calls: {},
  errors: [],
};

function fail(where, error) {
  result.errors.push(`${where}: ${error && error.message ? error.message : String(error)}`);
}

// A test that hangs is a failed test, not a hung phone.
const deadline = setTimeout(() => {
  result.errors.push("timed out: the whole uTP scenario did not finish in 30s");
  emit(1);
}, 30_000);
deadline.unref?.();

function emit(code) {
  clearTimeout(deadline);
  process.stdout.write(`OMB_UTP_RESULT ${JSON.stringify(result)}\n`);
  // Sockets in libutp keep the loop alive; this test is done either way.
  process.exit(code);
}

let utp;
try {
  utp = require(target);
  result.resolvedFrom = require.resolve(target);
} catch (error) {
  fail("require", error);
  emit(1);
}

result.api = {
  createServer: typeof utp.createServer,
  connect: typeof utp.connect,
  typeofSelf: typeof utp,
};

const ipv4 = "127.0.0.1";
const payloadIn = "ping-from-client";
const payloadOut = Buffer.alloc(96 * 1024, 0x42); // 96 KB: segmented by uTP, not one datagram

runIpv4(() => runErrorPath(() => emit(result.ok ? 0 : 1)));

function runIpv4(next) {
  const server = utp.createServer((socket) => {
    const from = `${socket.remoteAddress}:${socket.remotePort}`;
    result.calls.serverAccepted = from;
    socket.on("data", (data) => {
      result.calls.serverReceivedBytes = (result.calls.serverReceivedBytes || 0) + data.length;
      result.calls.serverReceivedText = data.toString();
      socket.write(payloadOut);
    });
    socket.on("end", () => socket.end());
    socket.on("error", (error) => fail("server socket", error));
  });
  server.on("error", (error) => {
    fail("server", error);
    next();
  });

  server.listen(0, ipv4, () => {
    const bound = server.address();
    result.calls.serverAddress = bound;
    const client = utp.connect(bound.port, ipv4);
    let received = 0;
    let closed = false;

    const finish = () => {
      if (closed) return;
      closed = true;
      server.close();
      result.calls.clientReceivedBytes = received;
      result.calls.serverAccepted = result.calls.serverAccepted || null;
      result.calls.serverReceivedText = result.calls.serverReceivedText || null;
      // The transfer only counts if both directions really moved.
      const movedBothWays =
        result.calls.serverReceivedText === payloadIn && received === payloadOut.length;
      result.calls.bidirectionalTransfer = movedBothWays;
      if (!movedBothWays) {
        result.errors.push(
          `transfer incomplete: server saw ${JSON.stringify(result.calls.serverReceivedText)}, client got ${received}/${payloadOut.length} bytes`,
        );
      }
      result.ok = result.errors.length === 0;
      next();
    };

    client.on("connect", () => {
      result.calls.clientConnected = true;
      client.write(payloadIn);
    });
    // The close has to be initiated by somebody: the server only ends its own
    // side once it sees a FIN from the client, so the client ends as soon as
    // it has the whole payload. Waiting for the other side to start would
    // deadlock, which is a property of the scenario, not of libutp.
    client.on("data", (data) => {
      received += data.length;
      if (received >= payloadOut.length) client.end();
    });
    client.on("end", () => client.end());
    client.on("close", finish);
    client.on("error", (error) => {
      fail("client", error);
      finish();
    });
    setTimeout(() => {
      if (!closed) {
        result.errors.push("client did not close within 15s");
        finish();
      }
    }, 15_000).unref?.();
  });
}

function runErrorPath(next) {
  // A connect to a port nothing is listening on must not look like success:
  // libutp retries, so this is asserted through the absence of a connection
  // plus an eventual timeout/error, never through a resolved promise.
  const socket = utp.connect(1, "127.0.0.1");
  let settled = false;
  socket.on("error", (error) => {
    if (settled) return;
    settled = true;
    result.calls.errorPath = `error: ${error.message}`;
    cleanup();
  });
  socket.on("connect", () => {
    if (settled) return;
    settled = true;
    result.calls.errorPath = "connected (unexpected)";
    result.errors.push("connect() to a dead port reported success");
    cleanup();
  });
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    result.calls.errorPath = "timed out without connecting (expected)";
    cleanup();
  }, 4_000);

  function cleanup() {
    clearTimeout(timer);
    try {
      socket.destroy();
    } catch (error) {
      fail("destroy", error);
    }
    next();
  }
}
