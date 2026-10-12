#!/usr/bin/env node
// The rest of the phone's networking, checked with the addons in place.
//
//   <libnode_host.so> net-regression.cjs <.../torlnk/node_modules>
//
// Adding two native addons to the process is exactly the kind of change that
// can leave the ordinary paths broken, so this exercises them independently of
// torrents:
//
//   LOOPBACK_TCP   a real TCP listener and connection inside the runtime
//   UDP_ROUNDTRIP  a DNS query to a public resolver over a raw UDP socket, and
//                  the answer parsed — a real datagram exchange, not a bind
//   DNS            name resolution through the runtime's own resolver
//   HTTPS          a real TLS request (the same OpenSSL the DTLS handshake uses)
//   DHT            bittorrent-dht bootstrapping over UDP, the way a torrent
//                  client does before it has any peers
//
// Every line is a measurement; the exit status is the verdict.

"use strict";const dgram = require("node:dgram");
const net = require("node:net");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

const tree = process.argv[2];
if (!tree) {
  console.error("usage: net-regression.cjs <.../node_modules>");
  process.exit(2);
}

const failures = [];
const line = (key, value) => console.log(`NET_${key} ${value}`);
function pass(name, detail) {
  console.log(`ok   ${name}${detail ? `: ${detail}` : ""}`);
}
function fail(name, detail) {
  failures.push(name);
  console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
}

function once(emitter, event, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    emitter.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

/** A DNS A-record query for [name], built and parsed here. */
function dnsQuery(name) {
  const header = Buffer.from([0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
  const labels = name.split(".").flatMap((label) => {
    const bytes = Buffer.from(label, "ascii");
    return [Buffer.from([bytes.length]), bytes];
  });
  return Buffer.concat([header, ...labels, Buffer.from([0]), Buffer.from([0x00, 0x01, 0x00, 0x01])]);
}

function firstAnswerAddress(response) {
  // Skip the header and the echoed question, then read the first A record.
  let offset = 12;
  while (offset < response.length && response[offset] !== 0) offset += response[offset] + 1;
  offset += 5; // null label + qtype + qclass
  while (offset + 12 <= response.length) {
    const type = response.readUInt16BE(offset + 2);
    const length = response.readUInt16BE(offset + 10);
    if (type === 1 && length === 4) return `${response[offset + 12]}.${response[offset + 13]}.${response[offset + 14]}.${response[offset + 15]}`;
    offset += 12 + length;
  }
  return null;
}

async function loopbackTcp() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const accepted = new Promise((resolve) => server.once("connection", resolve));
  const client = net.connect(port, "127.0.0.1");
  const socket = await accepted;
  const echo = new Promise((resolve) => socket.once("data", resolve));
  client.write("omb-tcp-probe");
  const got = (await echo).toString();
  client.destroy();
  socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  if (got !== "omb-tcp-probe") throw new Error(`echo mismatch: ${JSON.stringify(got)}`);
  return `port ${port}, echoed ${got.length} bytes`;
}

async function udpRoundTrip() {
  const socket = dgram.createSocket("udp4");
  await new Promise((resolve) => socket.bind(0, "0.0.0.0", resolve));
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no UDP reply in 8s")), 8000);
    socket.once("message", (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
  socket.send(dnsQuery("one.one.one.one"), 53, "1.1.1.1");
  const message = await reply;
  socket.close();
  const address = firstAnswerAddress(message);
  if (!address) throw new Error(`${message.length} byte reply carried no A record`);
  return `1.1.1.1:53 answered with ${address}`;
}

async function dhtBootstrap() {
  // bittorrent-dht is ESM with an import-only exports map, so it is imported
  // by path; a CJS require of it is refused by design, not by this device.
  const module = await import(pathToFileURL(join(tree, "bittorrent-dht", "index.js")).href);
  const DHT = module.default;
  const dht = new DHT({ bootstrap: ["router.bittorrent.com:6881", "dht.transmissionbt.com:6881"] });
  try {
    dht.listen(0);
    await once(dht, "ready", 25_000);
    const nodes = dht.nodes ? dht.nodes.toArray().length : 0;
    const peers = dht.countPeers ? dht.countPeers("0000000000000000000000000000000000000000") : 0;
    return `ready with ${nodes} routing-table nodes (address ${JSON.stringify(dht.address())}), udp peers tracked: ${peers}`;
  } finally {
    dht.destroy();
  }
}

async function main() {
  line("NODE", process.version);

  try {
    pass("a TCP listener and connection work inside the runtime", await loopbackTcp());
  } catch (error) {
    fail("a TCP listener and connection work inside the runtime", String(error.message ?? error));
  }

  try {
    pass("a raw UDP datagram round trip works", await udpRoundTrip());
  } catch (error) {
    fail("a raw UDP datagram round trip works", String(error.message ?? error));
  }

  try {
    const started = Date.now();
    const response = await fetch("https://one.one.one.one/dns-query?name=example.com&type=A", {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json();
    const address = body?.Answer?.[0]?.data ?? "no answer";
    pass("DNS over HTTPS works through the runtime's TLS", `${response.status} in ${Date.now() - started}ms, example.com → ${address}`);
  } catch (error) {
    fail("DNS over HTTPS works through the runtime's TLS", String(error.message ?? error));
  }

  try {
    pass("bittorrent-dht bootstraps over UDP", await dhtBootstrap());
  } catch (error) {
    fail("bittorrent-dht bootstraps over UDP", String(error.message ?? error));
  }

  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
  line("RESULT", failures.length ? `fail (${failures.join("; ")})` : "pass");
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  fail("the scenario ran", String(error.message ?? error));
  line("RESULT", "fail (scenario)");
  process.exit(1);
});
