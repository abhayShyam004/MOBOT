// Network security guard for the Android resource tools.
//
// The model can construct arbitrary URLs, so the resource layer is a natural
// SSRF primitive unless every destination is validated — including every
// redirect hop and the actual IP address DNS returns. `http_fetch`'s original
// regex checked the HOSTNAME text, not resolved addresses, and undici's
// default `redirect: "follow"` would happily walk a public URL into
// `http://127.0.0.1:PORT` (or a 169.254.x metadata service). This module is
// the only path the resource tools (and now http_fetch) use to touch the
// network, and it closes that class of hole.
//
// Policy (fail closed):
//   • http/https only; userinfo in the URL is refused.
//   • Every hop's hostname must resolve to at least one public, non-special
//     unicast address. Loopback (v4+v6), private (RFC1918), CGNAT (100.64/10),
//     link-local incl. cloud metadata (169.254/16), ULA (fc00::/7), multicast,
//     benchmarking/documentation ranges, unspecified (0.0.0.0/::) and the
//     IPv4-mapped IPv6 forms of all of the above are refused.
//   • https→http downgrade across a redirect chain is refused.
//   • Redirect hops are capped (MAX_REDIRECTS); every hop is re-validated.
//   • DNS is resolved by us (dns.promises), and the request can ONLY connect
//     to the addresses we validated: node's `lookup` option is replaced with
//     a pinned lookup, so a rebinding DNS answer cannot slip a connection
//     past validation. TLS SNI/hostname verification still uses the real
//     hostname (node passes `servername` separately from the connected IP).
//   • Bodies are bounded everywhere; downloads stream to disk in chunks and
//     never hold the whole entity in memory. Decompression is bounded too, so
//     a gzip bomb cannot exhaust memory or disk.
import http from "node:http";
import https from "node:https";
import { promises as dnsPromises } from "node:dns";
import net from "node:net";
import zlib from "node:zlib";
import type { IncomingMessage } from "node:http";

export const MAX_REDIRECTS = 8;

/** TEST SEAM (same pattern as AC_SYSTEM_BIN): the adapter integration suite
 *  runs against a fixture server on loopback, which the policy otherwise
 *  refuses. Lists EXACT host literals (never name wildcards); seeded only
 *  from the test env var, clearable/resettable per test. HarnessHost never
 *  sets this, and a user cannot inject it into the android_computer entry
 *  (the seed rewrites that entry's env every boot). */
const TEST_ALLOW_LOOPBACK_HOSTS = new Set<string>(
  process.env.OMB_NETGUARD_ALLOW_LOOPBACK === "1" ? ["127.0.0.1", "::1"] : [],
);
/** Add exact host literals to the test seam (tests only; must be literals). */
export function netguardTestAllowHosts(hosts: string[]): void {
  for (const host of hosts) TEST_ALLOW_LOOPBACK_HOSTS.add(host.toLowerCase());
}
/** Reset the seam + DNS cache between tests. */
export function netguardTestReset(): void {
  TEST_ALLOW_LOOPBACK_HOSTS.clear();
  dnsCache.clear();
}

export class NetworkPolicyError extends Error {}
export class DownloadAbortedError extends Error {}

// ── address policy ──────────────────────────────────────────────────────────

/** IPv6 text form → 8 groups of 16-bit values (throws on garbage).
 *
 *  Strategy: let the WHATWG URL parser canonicalize the address first. It
 *  validates strictly, strips zone ids, lowercases, and rewrites the
 *  trailing dotted-quad form ("::ffff:127.0.0.1") into pure hex groups —
 *  after which the remainder is a strict, dot-free grammar we can split
 *  without any embedded-IPv4 corner cases. */
function ipv6Groups(ip: string): number[] {
  const body = new URL(`http://[${ip}]/`).hostname.replace(/^\[|\]$/g, "");
  if (body.includes(".")) throw new Error("dotted form survived canonicalization");
  const halves = body.split("::");
  if (halves.length > 2) throw new Error("invalid IPv6");
  const parse = (group: string): number => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) throw new Error("invalid IPv6");
    return parseInt(group, 16);
  };
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  const groups = left.map(parse);
  const fill = 8 - groups.length - right.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) throw new Error("invalid IPv6");
  for (let i = 0; i < fill; i += 1) groups.push(0);
  groups.push(...right.map(parse));
  if (groups.length !== 8) throw new Error("invalid IPv6");
  return groups;
}

/** True when the address is one the policy forbids: loopback, private,
 * link-local (incl. cloud metadata), CGNAT, ULA, multicast, reserved,
 * benchmarking/documentation, or unspecified. */
export function ipIsForbidden(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const b = Buffer.from(ip.split(".").map(Number));
    if (b.length !== 4 || b.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true;
    return (
      b[0] === 0 || // "this network" incl. 0.0.0.0
      b[0] === 10 || // RFC1918
      b[0] === 127 || // loopback
      (b[0] === 100 && (b[1]! & 0xc0) === 64) || // CGNAT 100.64/10
      (b[0] === 169 && b[1] === 254) || // link-local (cloud metadata)
      (b[0] === 172 && (b[1]! & 0xf0) === 16) || // RFC1918
      (b[0] === 192 && b[1] === 0 && (b[2] === 0 || b[2] === 2)) || // 192.0.0/24, TEST-NET-1
      (b[0] === 192 && b[1] === 168) || // RFC1918
      (b[0] === 198 && (b[1]! & 0xfe) === 18) || // benchmarking 198.18/15
      (b[0] === 198 && b[1] === 51 && b[2] === 100) || // TEST-NET-2
      (b[0] === 203 && b[1] === 0 && b[2] === 113) || // TEST-NET-3
      (b[0]! & 0xf0) === 224 || // multicast
      (b[0]! & 0xf0) === 240 || // reserved + broadcast
      false
    );
  }
  if (!net.isIPv6(ip)) return true;
  let buf: Buffer;
  try {
    buf = Buffer.from(ipv6Groups(ip).flatMap((group) => [group >> 8, group & 0xff]));
  } catch {
    return true;
  }
  const isZero = buf.every((byte) => byte === 0);
  const isLoopback = buf.subarray(0, 15).every((byte) => byte === 0) && buf[15] === 1;
  const isUla = (buf[0]! & 0xfe) === 0xfc;
  const isLinkLocal = buf[0] === 0xfe && (buf[1]! & 0xc0) === 0x80;
  const isMulticast = buf[0] === 0xff;
  if (isZero || isLoopback || isUla || isLinkLocal || isMulticast) return true;
  // Transition technologies (NAT64 64:ff9b::/96, 6to4 2002::/16) embed an
  // IPv4 address inside a syntactically-public v6 literal; a hostile answer
  // can smuggle 127.0.0.1 or 10.0.0.0/8 through them. Check the embedded v4.
  const embedded =
    (buf[0] === 0x00 && buf[1] === 0x64 && buf[2] === 0xff && buf[3] === 0x9b) ? buf.subarray(12) : // NAT64 64:ff9b::/96: last 4 bytes
    (buf[0] === 0x20 && buf[1] === 0x02) ? buf.subarray(2, 6) : null; // 6to4 2002::/16: bytes 2..5
  if (embedded) {
    const v4 = `${embedded[0]}.${embedded[1]}.${embedded[2]}.${embedded[3]}`;
    if (net.isIPv4(v4) && ipIsForbidden(v4)) return true;
    // Deprecated either way: 6to4 with no embedded v4 left to check.
    if (buf[0] === 0x20 && buf[1] === 0x02) return true;
  }
  // IPv4-mapped (::ffff:a.b.c.d): re-check the v4 ranges — Android may
  // normalize either way and the mapped form must not smuggle a private v4.
  if (buf.subarray(0, 10).every((byte) => byte === 0) && buf[10] === 0xff && buf[11] === 0xff) {
    const [a, b, c] = [buf[12]!, buf[13]!, buf[14]!];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && (b & 0xc0) === 64) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && (b & 0xf0) === 16) return true;
    if (a === 192 && (b === 0 || b === 168)) return true;
    if (a === 198 && ((b & 0xfe) === 18 || (b === 51 && c === 100))) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if ((a & 0xf0) >= 224) return true;
  }
  return false;
}

/** Validate a URL against the policy. Throws NetworkPolicyError. */
export function validateUrl(raw: unknown): URL {
  if (typeof raw !== "string") throw new NetworkPolicyError("url is required");
  const text = raw.trim();
  if (!text || text.length > 2_048) {
    throw new NetworkPolicyError("url must be a non-empty http(s) URL of at most 2048 characters");
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new NetworkPolicyError("url is not a valid absolute URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new NetworkPolicyError(`only http and https URLs are allowed (got ${parsed.protocol || "unknown"})`);
  }
  if (parsed.username || parsed.password) {
    throw new NetworkPolicyError("credentials in the URL are not allowed");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (TEST_ALLOW_LOOPBACK_HOSTS.has(host.toLowerCase())) return parsed;
  if (!host) throw new NetworkPolicyError("url has no host");
  if (net.isIP(host)) {
    if (ipIsForbidden(host)) {
      throw new NetworkPolicyError(`requests to ${host} are not allowed: private, loopback and link-local addresses are refused`);
    }
  } else if (/^localhost$|\.localhost$|\.local$|\.internal$|\.home\.arpa$/i.test(host)) {
    throw new NetworkPolicyError(`requests to ${host} are not allowed: local hostnames are refused`);
  }
  return parsed;
}

// ── DNS: resolve + validate, then PIN the connection to the answer ─────────

export interface ResolvedTarget {
  url: URL;
  /** Validated public addresses for this hop's hostname. */
  addresses: string[];
}

const dnsCache = new Map<string, { addresses: string[]; expires: number }>();
const DNS_CACHE_MS = 60_000;

/** Resolve `url.hostname` and keep only policy-allowed addresses. Throws
 * NetworkPolicyError when nothing public remains (all-private answer,
 * NXDOMAIN, resolver failure). Literal IPs skip the resolver. */
export async function resolveTarget(url: URL): Promise<ResolvedTarget> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // Test seam first: exact literals only, no DNS round-trip.
  if (TEST_ALLOW_LOOPBACK_HOSTS.has(host.toLowerCase())) {
    return { url, addresses: [host] };
  }
  if (net.isIP(host)) {
    return { url, addresses: [host] };
  }
  const cached = dnsCache.get(host);
  if (cached && cached.expires > Date.now()) {
    return { url, addresses: cached.addresses };
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await dnsPromises.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      throw new NetworkPolicyError(`DNS lookup failed for ${host} (${code})`);
    }
    throw new NetworkPolicyError(`could not resolve ${host}`);
  }
  if (!records.length) throw new NetworkPolicyError(`DNS returned no addresses for ${host}`);
  const allowed = records.map((record) => record.address).filter((address) => !ipIsForbidden(address));
  if (!allowed.length) {
    throw new NetworkPolicyError(`${host} resolves only to private/loopback addresses, which are refused`);
  }
  dnsCache.set(host, { addresses: allowed, expires: Date.now() + DNS_CACHE_MS });
  return { url, addresses: allowed };
}

/** node `lookup` replacement: hands node ONLY an address we validated, so
 * the socket can never connect anywhere else (DNS rebinding is structurally
 * impossible for this request).
 *
 * Address selection has to respect node's lookup-callback contract: when the
 * callback reports family 6 for a request that did not ask for a family,
 * node's net layer re-parses the address through a path that expects the
 * `family` option it was never given, and dies with
 * `ERR_INVALID_IP_ADDRESS: undefined` BEFORE any connection attempt — seen on
 * an ARM64 phone whose resolver answered AAAA-first. Dual-stack hosts are the
 * norm, so the pin prefers a validated IPv4 address when one exists (phones
 * on carrier networks frequently have no usable v6 route), and otherwise
 * reports the v6 address with an explicit family of 6, which node accepts. */
function pinnedLookup(addresses: string[]): NonNullable<https.RequestOptions["lookup"]> {
  return ((_hostname: string, options: { family?: number | string } | null, callback: (error: NodeJS.ErrnoException | null, address?: string, family?: number) => void) => {
    const requested = Number(options?.family ?? 0);
    const pool = requested === 6
      ? addresses.filter((address) => net.isIPv6(address))
      : requested === 4
        ? addresses.filter((address) => net.isIPv4(address))
        : addresses;
    const candidates = pool.length ? pool : addresses;
    const address = candidates.find((candidate) => net.isIPv4(candidate)) ?? candidates[0]!;
    const family = net.isIPv6(address) ? 6 : 4;
    callback(null, address, family);
  }) as NonNullable<https.RequestOptions["lookup"]>;
}

// ── the guarded request pipeline ────────────────────────────────────────────

const USER_AGENT = "OpenMausBot-Android/1.0 (resource tools)";

export interface ResponseMeta {
  url: URL;
  status: number;
  statusText: string;
  contentType: string;
  contentDisposition: string | null;
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
  headers: Record<string, string>;
}

function metaOf(url: URL, response: IncomingMessage): ResponseMeta {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ").slice(0, 512) : value.slice(0, 512);
  }
  return {
    url,
    status: response.statusCode ?? 0,
    statusText: response.statusMessage ?? "",
    contentType: (headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "",
    contentDisposition: headers["content-disposition"] ?? null,
    etag: headers.etag ?? null,
    lastModified: headers["last-modified"] ?? null,
    contentLength: headers["content-length"] != null && /^\d+$/.test(headers["content-length"]) ? Number(headers["content-length"]) : null,
    headers,
  };
}

/** RFC 6266 filename production, including RFC 5987 filename*=UTF-8''… */
export function contentDispositionFilename(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = disposition.match(/filename\*\s*=\s*(?:utf-8|UTF-8)''([^;]+)/);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch { /* malformed ext-value; fall through */ }
  }
  const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plain?.[1]?.trim() || null;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** One hop: validated DNS + pinned connect + real TLS verification. */
function sendRequest(
  target: ResolvedTarget,
  method: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
  signal: AbortSignal | undefined,
): http.ClientRequest {
  const isTls = target.url.protocol === "https:";
  // The pin prefers a validated IPv4 address when one exists (see
  // pinnedLookup), so the request must ASK for family 4 to match — node's
  // lookup-callback contract re-parses the address against the request's
  // `family` option, and an unset family with a v6-first answer is exactly
  // the ERR_INVALID_IP_ADDRESS: undefined failure seen on ARM64 phones.
  const wantsV6 = !target.addresses.some((address) => net.isIPv4(address));
  const request = (isTls ? https : http).request(target.url, {
    method,
    family: wantsV6 ? 6 : 4,
    // Built once: user-agent + accept-encoding + caller headers + length.
    headers: {
      "user-agent": USER_AGENT,
      "accept-encoding": "gzip, deflate, br",
      ...headers,
      ...(body ? { "content-length": String(body.length) } : {}),
    },
    lookup: pinnedLookup(target.addresses),
    servername: isTls ? target.url.hostname.replace(/^\[|\]$/g, "") : undefined,
    agent: false, // no socket pooling: every connection goes through the pin
    // The overall deadline is the caller's AbortSignal (AbortSignal.timeout);
    // a socket-level `timeout` here would emit an unhandled 'timeout' event.
    ...(signal ? { signal } : {}),
  });
  if (body) request.end(body);
  else request.end();
  return request;
}

function waitResponse(request: http.ClientRequest): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    request.once("response", resolve);
    request.once("error", reject);
  });
}

export interface OpenGuarded {
  response: IncomingMessage;
  meta: ResponseMeta;
  finalUrl: URL;
  redirectCount: number;
  method: string;
}

/** Walk a redirect chain with per-hop validation. Returns the FINAL response
 *  UNCONSUMED (the caller drains it); destroying it is the caller's job. */
export async function openGuarded(
  startUrl: URL,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<OpenGuarded> {
  let method = (options.method ?? "GET").toUpperCase();
  // The payload follows the method: a 301/302/303 POST that becomes GET
  // must NOT re-send its body (a GET with a body is a protocol smell some
  // servers reject); 307/308 keep both.
  let payload = options.body;
  let current: URL = startUrl;
  let redirectCount = 0;
  for (;;) {
    if (options.signal?.aborted) throw new DownloadAbortedError("cancelled");
    const target = await resolveTarget(current);
    const timer = AbortSignal.timeout(options.timeoutMs);
    const composite = options.signal ? AbortSignal.any([options.signal, timer]) : timer;
    const request = sendRequest(target, method, options.headers ?? {}, payload, composite);
    let response: IncomingMessage;
    try {
      response = await waitResponse(request);
    } catch (error) {
      request.destroy();
      if (options.signal?.aborted) throw new DownloadAbortedError("cancelled");
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /timed?\s?out/i.test(error.message))) {
        throw new NetworkPolicyError(`request timed out after ${Math.round(options.timeoutMs / 1000)}s`);
      }
      throw error;
    }
    if (isRedirect(response.statusCode ?? 0) && response.headers.location) {
      response.resume(); // discard the (tiny) redirect body
      if (redirectCount >= MAX_REDIRECTS) {
        throw new NetworkPolicyError(`too many redirects (more than ${MAX_REDIRECTS})`);
      }
      let next: URL;
      try {
        next = new URL(String(response.headers.location), current);
      } catch {
        throw new NetworkPolicyError("redirect location is not a valid URL");
      }
      const validated = validateUrl(next.href);
      if (validated.protocol === "http:" && current.protocol === "https:") {
        throw new NetworkPolicyError("redirect would downgrade https to http; refusing");
      }
      // 303 always becomes GET; 301/302 keep the method for GET/HEAD and
      // become GET otherwise (browser convention); 307/308 keep everything.
      if (response.statusCode === 303 || (response.statusCode !== 307 && response.statusCode !== 308 && method !== "GET" && method !== "HEAD")) {
        method = "GET";
        payload = undefined;
      }
      current = validated;
      redirectCount += 1;
      continue;
    }
    if (isRedirect(response.statusCode ?? 0)) {
      response.resume();
      throw new NetworkPolicyError(`redirect without a location header (HTTP ${response.statusCode})`);
    }
    return { response, meta: metaOf(current, response), finalUrl: current, redirectCount, method };
  }
}

// ── body reading: bounded, decompressed ─────────────────────────────────────

/** Wrap the response stream with decompression per content-encoding. */
function decodeStream(response: IncomingMessage): NodeJS.ReadableStream {
  const encoding = String(response.headers["content-encoding"] ?? "").trim().toLowerCase();
  if (encoding === "gzip") return response.pipe(zlib.createGunzip());
  if (encoding === "deflate") return response.pipe(zlib.createInflate());
  if (encoding === "br") return response.pipe(zlib.createBrotliDecompress());
  return response;
}

async function readBoundedStream(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
  signal: AbortSignal | undefined,
  onChunk?: (chunk: Buffer) => Promise<void> | void,
  mode: "throw" | "truncate" = "throw",
): Promise<{ buffer: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  try {
    for await (const raw of stream) {
      if (signal?.aborted) throw new DownloadAbortedError("cancelled");
      const chunk = Buffer.from(raw as Buffer);
      total += chunk.length;
      if (total > maxBytes) {
        if (mode === "truncate") {
          // Keep the prefix up to EXACTLY maxBytes (deterministic body size
          // for callers with fixed caps), stop reading; the caller reports
          // the truncation. The stream is cancelled just below.
          const overflow = total - maxBytes;
          const kept = chunk.length - overflow;
          if (kept > 0) chunks.push(chunk.subarray(0, kept));
          truncated = true;
          break;
        }
        throw new NetworkPolicyError(`response body exceeds the ${maxBytes} byte limit`);
      }
      chunks.push(chunk);
      if (onChunk) await onChunk(chunk);
    }
  } catch (error) {
    if (error instanceof NetworkPolicyError || error instanceof DownloadAbortedError) throw error;
    if (signal?.aborted) throw new DownloadAbortedError("cancelled");
    if (error instanceof Error && /aborted/i.test(error.message)) throw new DownloadAbortedError("cancelled");
    throw error;
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

export interface GuardedGetResult {
  meta: ResponseMeta;
  finalUrl: URL;
  redirectCount: number;
  /** Decompressed body, capped at maxBytes (decompressed size). */
  body: Buffer;
}

/** Guarded request with a bounded, decompressed body. With
 *  onOversize "throw" (default) a too-large body fails the request; with
 *  "truncate" the first maxBytes are returned and `truncated` is set. */
export async function guardedRequest(
  url: URL,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer;
    maxBodyBytes: number;
    timeoutMs: number;
    signal?: AbortSignal;
    onOversize?: "throw" | "truncate";
  },
): Promise<GuardedGetResult & { truncated: boolean }> {
  const opened = await openGuarded(url, options);
  const cap = opened.meta.status >= 400 ? Math.min(options.maxBodyBytes, 64 * 1024) : options.maxBodyBytes;
  try {
    const read = await readBoundedStream(decodeStream(opened.response), cap, options.signal, undefined, options.onOversize ?? "throw");
    return { meta: opened.meta, finalUrl: opened.finalUrl, redirectCount: opened.redirectCount, body: read.buffer, truncated: read.truncated };
  } catch (error) {
    opened.response.destroy();
    throw error;
  }
}

/** Guarded GET that hands the caller a bounded streaming consumer (the whole
 *  point: a 50MB download never exists in memory as one buffer). */
export async function guardedStream(
  url: URL,
  options: { timeoutMs: number; signal?: AbortSignal; headers?: Record<string, string> },
): Promise<{ meta: ResponseMeta; finalUrl: URL; redirectCount: number; consume: (write: (chunk: Buffer) => Promise<void> | void, maxBytes: number) => Promise<number> }> {
  const opened = await openGuarded(url, { method: "GET", timeoutMs: options.timeoutMs, signal: options.signal, headers: options.headers });
  const stream = decodeStream(opened.response);
  return {
    meta: opened.meta,
    finalUrl: opened.finalUrl,
    redirectCount: opened.redirectCount,
    consume: (write, maxBytes) => readBoundedStream(stream, maxBytes, options.signal, write).then((read) => read.buffer.length),
  };
}

/** Guarded HEAD (metadata only). Falls back to a body-discarding GET when the
 *  server refuses HEAD (405/501) — some CDNs do. */
export async function guardedInspect(
  url: URL,
  { timeoutMs, signal, headers }: { timeoutMs: number; signal?: AbortSignal; headers?: Record<string, string> },
): Promise<{ meta: ResponseMeta; finalUrl: URL; redirectCount: number }> {
  let opened: OpenGuarded | null = null;
  let headFailed = false;
  try {
    opened = await openGuarded(url, { method: "HEAD", timeoutMs, signal, headers });
  } catch (error) {
    if (error instanceof NetworkPolicyError || error instanceof DownloadAbortedError) throw error;
    headFailed = true; // transport-level HEAD failure: try GET
  }
  if (!opened || opened.meta.status === 405 || opened.meta.status === 501 || headFailed) {
    opened?.response.destroy();
    opened = await openGuarded(url, { method: "GET", timeoutMs, signal, headers });
    opened.response.destroy(); // headers are all we want
  } else {
    opened.response.destroy();
  }
  return { meta: opened.meta, finalUrl: opened.finalUrl, redirectCount: opened.redirectCount };
}

// ── error description (shared) ──────────────────────────────────────────────

/** Node network errors hide the reason on `cause`; chain it so the model
 *  sees what actually went wrong (same discipline as the old adapter). */
export function describeNetworkError(error: unknown): string {
  const chain: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as NodeJS.ErrnoException).code;
    const line = current.message + (code ? ` (${code})` : "");
    if (!chain.includes(line)) chain.push(line);
    current = (current as { cause?: unknown }).cause;
  }
  const joined = chain.join(" ← ");
  if (/certificate|SSL|TLS|self-signed/i.test(joined)) return `TLS failure (${joined})`;
  return joined || "network request failed";
}
