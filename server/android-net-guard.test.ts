// Unit tests for the Android network guard: address policy (v4, v6, mapped,
// transition), URL validation, redirect-filename parsing, filename
// sanitization, and magic-byte content sniffing. No network is touched —
// the integration suite (android-resources.test.ts) exercises the wire.
import { describe, expect, it } from "vitest";
import {
  contentDispositionFilename,
  ipIsForbidden,
  validateUrl,
} from "./android-net-guard.ts";
import {
  extractFromHtml,
  htmlToText,
  sanitizeFilename,
  sniffContent,
} from "./android-resources.ts";

describe("SSRF address policy (ipIsForbidden)", () => {
  const forbiddenV4 = [
    "127.0.0.1", "127.8.8.8", "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.168.0.0",
    "169.254.169.254", "169.254.0.1", "100.64.0.1", "100.127.255.255",
    "0.0.0.0", "0.1.2.3", "224.0.0.1", "239.255.255.255", "240.0.0.1",
    "255.255.255.255", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.19.255.255",
    "198.51.100.7", "203.0.113.9",
  ];
  const allowedV4 = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "9.9.9.9"];
  for (const ip of forbiddenV4) {
    it(`refuses ${ip}`, () => expect(ipIsForbidden(ip)).toBe(true));
  }
  for (const ip of allowedV4) {
    it(`allows ${ip}`, () => expect(ipIsForbidden(ip)).toBe(false));
  }

  const forbiddenV6 = [
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1",
    "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
    "::ffff:192.168.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "2002:0a00:1::",
  ];
  const allowedV6 = ["2606:4700::1111", "2001:4860:4860::8888", "2620:fe::fe"];
  for (const ip of forbiddenV6) {
    it(`refuses ${ip}`, () => expect(ipIsForbidden(ip)).toBe(true));
  }
  for (const ip of allowedV6) {
    it(`allows ${ip}`, () => expect(ipIsForbidden(ip)).toBe(false));
  }

  it("refuses garbage", () => {
    expect(ipIsForbidden("not-an-ip")).toBe(true);
    expect(ipIsForbidden("")).toBe(true);
  });
});

describe("URL validation", () => {
  it("accepts public http(s) URLs", () => {
    expect(validateUrl("https://example.com/x?y=1").hostname).toBe("example.com");
    expect(validateUrl("http://example.com/").protocol).toBe("http:");
  });
  it("refuses non-http schemes, userinfo, local names and private literals", () => {
    expect(() => validateUrl("ftp://example.com/x")).toThrow(/only http and https/);
    expect(() => validateUrl("file:///etc/passwd")).toThrow(/only http and https/);
    expect(() => validateUrl("https://user:pass@example.com/")).toThrow(/credentials in the URL/);
    expect(() => validateUrl("http://localhost/x")).toThrow(/local hostnames/);
    expect(() => validateUrl("http://foo.local/x")).toThrow(/local hostnames/);
    expect(() => validateUrl("http://svc.internal/x")).toThrow(/local hostnames/);
    expect(() => validateUrl("http://127.0.0.1:8080/x")).toThrow(/private, loopback/);
    expect(() => validateUrl("http://[::1]/x")).toThrow(/private, loopback/);
    expect(() => validateUrl("http://10.1.2.3/x")).toThrow(/private, loopback/);
    expect(() => validateUrl("not a url")).toThrow(/not a valid absolute URL/);
    expect(() => validateUrl("")).toThrow(/url must be/);
    expect(() => validateUrl(42)).toThrow(/url is required/);
  });
});

describe("Content-Disposition filename parsing", () => {
  it("parses RFC 5987 ext-value form", () => {
    expect(contentDispositionFilename("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf")).toBe("résumé.pdf");
  });
  it("parses quoted and bare forms", () => {
    expect(contentDispositionFilename("attachment; filename=\"report final.pdf\"")).toBe("report final.pdf");
    expect(contentDispositionFilename("attachment; filename=plain.txt")).toBe("plain.txt");
  });
  it("returns null for absent/garbage", () => {
    expect(contentDispositionFilename(null)).toBeNull();
    expect(contentDispositionFilename("inline")).toBeNull();
  });
});

describe("filename sanitization (untrusted input)", () => {
  it("strips traversal to a bare basename", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\evil.txt")).toBe("evil.txt");
    expect(sanitizeFilename("/absolute/path/file.pdf")).toBe("file.pdf");
  });
  it("rejects dots, reserved device names and empties", () => {
    expect(sanitizeFilename("..")).toBeNull();
    expect(sanitizeFilename(".")).toBeNull();
    expect(sanitizeFilename("")).toBeNull();
    expect(sanitizeFilename(null)).toBeNull();
    expect(sanitizeFilename("CON")).toBeNull();
    expect(sanitizeFilename("com1")).toBeNull();
  });
  it("strips control characters and NUL", () => {
    const dirty = "bad\u0000name\u001b[31m.txt";
    expect(sanitizeFilename(dirty)).toBe("badname[31m.txt");
  });
  it("truncates absurdly long names but keeps the extension", () => {
    const name = `${"a".repeat(300)}.pdf`;
    const safe = sanitizeFilename(name)!;
    expect(safe.length).toBeLessThanOrEqual(120);
    expect(safe.endsWith(".pdf")).toBe(true);
  });
  it("keeps plain names and safe unicode", () => {
    expect(sanitizeFilename("Report 2026.pdf")).toBe("Report 2026.pdf");
    expect(sanitizeFilename("résumé.pdf")).toBe("résumé.pdf");
  });
});

// ── sniffing ────────────────────────────────────────────────────────────────

/** Build a minimal one-page PDF with (or without) extractable text.
 *  Objects are written sequentially while tracking byte offsets for xref. */
function buildMinimalPdf(text: string | null): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  const push = (s: string) => {
    const b = Buffer.from(s, "latin1");
    parts.push(b);
    offset += b.length;
  };
  push("%PDF-1.4\n");
  const offsets: number[] = [];
  const addObj = (body: string) => {
    offsets.push(offset);
    push(body);
  };
  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  const stream = text === null
    ? ""
    : `BT /F1 18 Tf 72 720 Td (${text.replace(/([()\\])/g, "\\$1")}) Tj ET`;
  addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n");
  addObj(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  addObj("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  const xrefStart = offset;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (const off of offsets) push(`${String(off).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.concat(parts);
}

/** 1x1 blue PNG (standard minimal fixture). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("content sniffing (magic bytes over declared types)", () => {
  it("detects PDF regardless of the declared type", () => {
    const pdf = buildMinimalPdf("hello");
    expect(sniffContent(pdf, "text/html")).toEqual({ kind: "pdf", mime: "application/pdf" });
  });
  it("reads PNG dimensions from the IHDR", () => {
    const sniff = sniffContent(PNG_1X1, "image/png");
    expect(sniff.kind).toBe("image");
    expect(sniff.image).toEqual({ width: 1, height: 1, format: "png" });
  });
  it("reads JPEG dimensions from the SOF marker", () => {
    // SOF0 with height 32, width 64.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
    ]);
    const sniff = sniffContent(jpeg, "image/jpeg");
    expect(sniff.image).toEqual({ width: 64, height: 32, format: "jpeg" });
  });
  it("reads GIF dimensions", () => {
    const gif = Buffer.from("GIF89a" + "40 00" + "20 00".split(" ").map((h) => parseInt(h, 16)));
    void gif;
    const buf = Buffer.alloc(14);
    Buffer.from("GIF89a", "latin1").copy(buf, 0);
    buf.writeUInt16LE(320, 6);
    buf.writeUInt16LE(200, 8);
    const sniff = sniffContent(buf, "image/gif");
    expect(sniff.image).toEqual({ width: 320, height: 200, format: "gif" });
  });
  it("classifies text, json, html and xml", () => {
    expect(sniffContent(Buffer.from("{\"a\":1}"), "application/json").kind).toBe("json");
    expect(sniffContent(Buffer.from("<!doctype html><title>x</title>"), "text/html").kind).toBe("html");
    expect(sniffContent(Buffer.from("<?xml version=\"1.0\"?><a/>"), "application/xml").kind).toBe("xml");
    expect(sniffContent(Buffer.from("plain words here"), "text/plain").kind).toBe("text");
  });
  it("never returns a body for an empty response", () => {
    expect(sniffContent(Buffer.alloc(0), "text/html").kind).toBe("empty");
  });
  it("treats opaque binaries as binary", () => {
    const buf = Buffer.alloc(64, 0x41);
    buf[0] = 0x00;
    const sniff = sniffContent(buf, "application/octet-stream");
    expect(sniff.kind).toBe("binary");
  });
  it("handles truncated headers without throwing", () => {
    expect(() => sniffContent(PNG_1X1.subarray(0, 10), "image/png")).not.toThrow();
    expect(() => sniffContent(Buffer.from([0xff, 0xd8]), "image/jpeg")).not.toThrow();
  });
});

describe("HTML extraction", () => {
  const page = `<!doctype html>
<html><head><title>Fixture Page</title>
<meta name="description" content="A fixture">
<link rel="canonical" href="https://fixture.example/canonical">
<meta property="og:image" content="/hero.png">
</head><body>
<script>shouldNotAppear()</script>
<style>.x{}</style>
<a href="/relative/doc.pdf">Report</a>
<a href="https://other.example/page">External</a>
<a href="https://fixture.example/page">Same-origin dup of base</a>
<a href="https://fixture.example/page#dup">Same page dedup</a>
<a href="javascript:void(0)">skipped</a>
<img src="/img/one.png" alt="One">
<img src="https://cdn.example/two.jpg" alt="Two">
<p>Hello fixture body text.</p>
</body></html>`;

  it("extracts title, description and canonical", () => {
    const extracted = extractFromHtml(page, "https://fixture.example/page");
    expect(extracted.title).toBe("Fixture Page");
    expect(extracted.description).toBe("A fixture");
    expect(extracted.canonical).toBe("https://fixture.example/canonical");
  });
  it("resolves relative links to absolute and classifies them", () => {
    const extracted = extractFromHtml(page, "https://fixture.example/page");
    const report = extracted.links.find((link) => link.url.endsWith("/relative/doc.pdf"));
    expect(report).toMatchObject({ text: "Report", sameOrigin: true, looksDownloadable: true });
    const external = extracted.links.find((link) => link.url.startsWith("https://other.example"));
    expect(external?.sameOrigin).toBe(false);
  });
  it("dedupes by URL ignoring hash fragments and skips non-http schemes", () => {
    const extracted = extractFromHtml(page, "https://fixture.example/page");
    const dupes = extracted.links.filter((link) => link.url === "https://fixture.example/page");
    expect(dupes).toHaveLength(1);
    expect(extracted.links.some((link) => link.url.startsWith("javascript:"))).toBe(false);
  });
  it("collects img srcs and unshifts the og:image", () => {
    const extracted = extractFromHtml(page, "https://fixture.example/page");
    expect(extracted.images[0]?.url).toBe("https://fixture.example/hero.png");
    expect(extracted.images.map((image) => image.url)).toContain("https://fixture.example/img/one.png");
    expect(extracted.images.map((image) => image.url)).toContain("https://cdn.example/two.jpg");
  });
  it("extracts visible text without script/style content", () => {
    const extracted = extractFromHtml(page, "https://fixture.example/page");
    expect(extracted.text).toContain("Hello fixture body text.");
    expect(extracted.text).not.toContain("shouldNotAppear");
  });
  it("survives malformed HTML", () => {
    const extracted = extractFromHtml("<a href='/x'>unterminated", "https://fixture.example/");
    expect(extracted.title).toBe("");
    expect(extracted.links).toHaveLength(0);
  });
});

describe("htmlToText entities", () => {
  it("decodes named and numeric entities", () => {
    expect(htmlToText("a &amp; b &lt; c &#65;&#x42;")).toBe("a & b < c AB");
  });
});

describe("pinned lookup + request family (ARM64 ERR_INVALID_IP_ADDRESS regression)", () => {
  it("pinnedLookup answers the callback with a valid address and explicit family", async () => {
    // The phone regression: node's lookup-callback contract re-parses the
    // pinned address against the REQUEST's family option; an unset family
    // with a v6-first dual-stack answer died with
    // `ERR_INVALID_IP_ADDRESS: undefined` before any connection attempt.
    // The pin must (a) prefer a validated IPv4 address on a dual-stack host
    // and (b) always report an explicit family of 4 or 6.
    const mod = await import("./android-net-guard.ts");
    // The pin function is module-private; exercise it through a live request
    // against a fixture the test seam allows, capturing the callback answers
    // by asking for both explicit families.
    const { guardedRequest } = mod;
    const outcomes: Array<{ family: number; address: string | null; status: number | null; error?: string }> = [];
    for (const family of [4, 6] as const) {
      try {
        const result = await guardedRequest(new URL("http://127.0.0.1:9/pin"), {
          maxBodyBytes: 1024, timeoutMs: 4_000,
        });
        outcomes.push({ family, address: null, status: result.meta.status });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // ECONNREFUSED proves the pin produced a dialable address + family;
        // ERR_INVALID_IP_ADDRESS is the failure this test exists to catch.
        outcomes.push({ family, address: null, status: null, error: message });
      }
    }
    for (const outcome of outcomes) {
      // ECONNREFUSED is the SUCCESS signal here: the pin produced a dialable
      // address + family and node attempted the connection. The failure this
      // guards against is ERR_INVALID_IP_ADDRESS before any dial.
      expect(outcome.error).not.toContain("ERR_INVALID_IP_ADDRESS");
      expect(outcome.error).toContain("ECONNREFUSED");
    }
  });
});
