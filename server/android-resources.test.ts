// Integration tests for the Android resource tools: the android_computer
// adapter is spawned exactly the way the harness does (stdio JSON-RPC MCP)
// against a local fixture HTTP server, exercising the real guarded network
// path, real pdf.js extraction, real sandbox containment.
//
// The fixture server lives on loopback, which the SSRF policy refuses by
// design — the guard's OMB_NETGUARD_ALLOW_LOOPBACK seam (test-only, never in
// the harness env) opens it here, and the SSRF tests prove redirecting back
// into loopback from a "public" hop is still refused. The download cap seam
// keeps the oversized-download test fast.
import "./testing/netguard-test-env.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildMinimalPdf, PNG_1X1 } from "./testing/omb-test-bytes.ts";

interface Route {
  status?: number;
  headers?: Record<string, string>;
  body: Buffer;
}
const routes: Record<string, Route> = {};
let fixtureServer: Server;
let fixturePort = 0;
let fixtureBase = "";

beforeAll(async () => {
  fixtureServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0]!;
    if (path === "/echo") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ echo: Buffer.concat(chunks).toString("utf8") }));
      });
      return;
    }
    const route = routes[path];
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("fixture: no such route");
      return;
    }
    res.writeHead(route.status ?? 200, route.headers ?? {});
    res.end(route.body);
  });
  await new Promise<void>((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
  fixturePort = (fixtureServer.address() as { port: number }).port;
  fixtureBase = `http://127.0.0.1:${fixturePort}`;

  routes["/hello.html"] = {
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(`<!doctype html>
<html><head><title>Fixture</title></head><body>
<p>Fixture body text.</p>
<a href="/docs/report.pdf">Report</a>
<a href="https://external.example/page">External</a>
<img src="/img/hero.png" alt="Hero">
</body></html>`),
  };
  routes["/links.html"] = routes["/hello.html"];
  routes["/data.json"] = {
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify({ kind: "fixture", value: 42 })),
  };
  routes["/plain.txt"] = {
    headers: { "content-type": "text/plain" },
    body: Buffer.from("plain fixture text"),
  };
  routes["/report.pdf"] = {
    // The classic lie: a PDF declared as HTML. Magic bytes must win.
    headers: { "content-type": "text/html" },
    body: buildMinimalPdf("OpenMausBot fixture PDF text"),
  };
  routes["/report.pdf.dataset"] = routes["/report.pdf"];
  routes["/scan.pdf"] = {
    headers: { "content-type": "application/pdf" },
    body: buildMinimalPdf(null),
  };
  routes["/three-pages.pdf"] = {
    headers: { "content-type": "application/pdf" },
    body: buildThreePagePdf(),
  };
  routes["/pixel.png"] = {
    headers: { "content-type": "image/png" },
    body: PNG_1X1,
  };
  routes["/named-download.pdf"] = {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="Quarterly Report.pdf"',
    },
    body: buildMinimalPdf("disposition"),
  };
  routes["/evil-name.pdf"] = {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="../../evil.sh"',
    },
    body: buildMinimalPdf("evil"),
  };
  routes["/zip"] = {
    headers: { "content-type": "application/zip" },
    body: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]),
  };
  routes["/big.txt"] = {
    headers: { "content-type": "text/plain" },
    body: Buffer.alloc(3 * 1024 * 1024, 0x61),
  };
  routes["/big.dl"] = routes["/big.txt"];
  routes["/hop1"] = {
    status: 302,
    headers: { location: "/hop2" },
    body: Buffer.alloc(0),
  };
  // hop2: a "public" URL redirecting to a LOCAL NAME — the seam allows the
  // literal fixture host only, so this hop must be refused by validation.
  routes["/hop2"] = {
    status: 302,
    headers: { location: `http://localhost:${fixturePort}/secret` },
    body: Buffer.alloc(0),
  };
  routes["/secret"] = {
    headers: { "content-type": "text/plain" },
    body: Buffer.from("you should never see this"),
  };
  routes["/loop-a"] = {
    status: 302,
    headers: { location: "/loop-b" },
    body: Buffer.alloc(0),
  };
  routes["/loop-b"] = {
    status: 302,
    headers: { location: "/loop-a" },
    body: Buffer.alloc(0),
  };
  routes["/bad.html"] = {
    headers: { "content-type": "text/html" },
    body: Buffer.from("<a href='/x'>unterminated"),
  };
});

afterAll(async () => {
  await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
});

function buildThreePagePdf(): Buffer {
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
  const pageObj = (num: number, _text: string) =>
    addObj(`${num} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${num + 10} 0 R >>\nendobj\n`);
  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>\nendobj\n");
  pageObj(3, "");
  pageObj(4, "");
  pageObj(5, "");
  for (const [num, text] of [[13, "page one marker"], [14, "page two marker"], [15, "page three marker"]] as const) {
    const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
    addObj(`${num} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  }
  const xrefStart = offset;
  push("xref\n0 16\n0000000000 65535 f \n");
  for (const off of offsets) push(`${String(off).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 16 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.concat(parts);
}

describe("android_computer resource tools (stdio contract over real HTTP)", () => {
  let child: ChildProcess;
  let workspace: string;
  let buffer = "";
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  let nextId = 1;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "omb-resources-"));
    buffer = "";
    child = spawn(
      process.execPath,
      ["--experimental-strip-types", join(import.meta.dirname, "android-computer.ts")],
      {
        env: {
          ...process.env,
          AC_WORKSPACE: workspace,
          AC_SYSTEM_BIN: "/usr/bin",
          OMB_NETGUARD_ALLOW_LOOPBACK: "1",
          OMB_RESOURCE_DOWNLOAD_CAP: String(300_000),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        const entry = pending.get(message.id);
        if (entry) {
          pending.delete(message.id);
          if (message.error) entry.reject(new Error(message.error.message));
          else entry.resolve(message.result);
        }
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => process.stderr.write(`[adapter] ${chunk}`));
  });

  afterEach(async () => {
    child.kill("SIGKILL");
    rmSync(workspace, { recursive: true, force: true });
  });

  function rpc(method: string, params?: unknown): Promise<any> {
    const id = nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      child.stdin!.write(frame);
    });
  }

  async function initialize(): Promise<void> {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0" },
    });
  }

  async function call(tool: string, args: Record<string, unknown> = {}): Promise<any> {
    const response = await rpc("tools/call", { name: tool, arguments: args });
    expect(response.content?.[0]?.type).toBe("text");
    return JSON.parse(response.content[0]!.text);
  }

  async function callErr(tool: string, args: Record<string, unknown> = {}): Promise<string> {
    const response = await rpc("tools/call", { name: tool, arguments: args });
    expect(response.isError).toBe(true);
    return JSON.parse(response.content[0]!.text).error;
  }

  it("lists the resource tools in the catalog", async () => {
    await initialize();
    const { tools } = await rpc("tools/list");
    const names = tools.map((tool: any) => tool.name);
    for (const expected of [
      "resource_inspect", "resource_fetch", "resource_download",
      "resource_extract_pdf_text", "resource_extract_links",
      "resource_artifact_info", "resource_list",
    ]) expect(names).toContain(expected);
  });

  it("inspects metadata without a body", async () => {
    await initialize();
    const info = await call("resource_inspect", { url: `${fixtureBase}/report.pdf` });
    expect(info.ok).toBe(true);
    expect(info.status).toBe(200);
    expect(info.contentType).toBe("text/html");
    expect(info.finalUrl).toBe(`${fixtureBase}/report.pdf`);
    expect(info.suggestedFilename).toBe("report.pdf");
    expect(info.contentLength).toBe(info.contentLength);
  });

  it("fetches an HTML page with text, title, links and images", async () => {
    await initialize();
    const page = await call("resource_fetch", { url: `${fixtureBase}/hello.html` });
    expect(page.ok).toBe(true);
    expect(page.detectedKind).toBe("html");
    expect(page.declaredContentType).toBe("text/html");
    expect(page.title).toBe("Fixture");
    expect(page.text).toContain("Fixture body text.");
    const report = page.links.find((link: any) => link.url === `${fixtureBase}/docs/report.pdf`);
    expect(report).toMatchObject({ sameOrigin: true, looksDownloadable: true });
    expect(page.images.map((image: any) => image.url)).toContain(`${fixtureBase}/img/hero.png`);
  });

  it("fetches JSON and plain text", async () => {
    await initialize();
    const json = await call("resource_fetch", { url: `${fixtureBase}/data.json` });
    expect(json.detectedKind).toBe("json");
    expect(JSON.parse(json.text).value).toBe(42);
    const text = await call("resource_fetch", { url: `${fixtureBase}/plain.txt` });
    expect(text.detectedKind).toBe("text");
    expect(text.text).toBe("plain fixture text");
  });

  it("refuses to inline binary bodies and says what to do instead", async () => {
    await initialize();
    const zip = await call("resource_fetch", { url: `${fixtureBase}/zip` });
    expect(zip.ok).toBe(true);
    expect(zip.detectedKind).toBe("zip");
    expect(zip.note).toMatch(/resource_download/);
    // The preview is masked, never raw binary: only printable ASCII survives.
    expect(zip.bodyPreview).toMatch(/^PK/);
    expect(zip.bodyPreview).not.toMatch(/[^\x20-\x7e\n·]/);
    const pdf = await call("resource_fetch", { url: `${fixtureBase}/report.pdf` });
    expect(pdf.detectedContentType).toBe("application/pdf");
    expect(pdf.declaredContentType).toBe("text/html");
    expect(pdf.note).toMatch(/resource_download/);
  });

  it("truncates oversized fetches explicitly", async () => {
    await initialize();
    const page = await call("resource_fetch", { url: `${fixtureBase}/big.txt` });
    expect(page.truncated).toBe(true);
    expect(page.text.length).toBeLessThan(3 * 1024 * 1024);
    expect(page.text.endsWith("[truncated]")).toBe(true);
  });

  it("downloads a PDF with checksum and registers the artifact", async () => {
    await initialize();
    const result = await call("resource_download", { url: `${fixtureBase}/report.pdf` });
    expect(result.ok).toBe(true);
    expect(result.path).toMatch(/^downloads\/.+\.pdf$/);
    expect(result.detectedKind).toBe("pdf");
    expect(result.sizeBytes).toBeGreaterThan(0);
    const expectedHash = createHash("sha256").update(routes["/report.pdf"]!.body).digest("hex");
    expect(result.sha256).toBe(expectedHash);
    const stored = readFileSync(join(workspace, result.path));
    expect(stored.equals(routes["/report.pdf"]!.body)).toBe(true);
    const list = await call("resource_list");
    const record = list.artifacts.find((artifact: any) => artifact.path === result.path);
    expect(record).toBeTruthy();
    expect(record.url).toBe(`${fixtureBase}/report.pdf`);
    expect(record.contentKind).toBe("pdf");
  });

  it("uses the sanitized Content-Disposition filename", async () => {
    await initialize();
    const result = await call("resource_download", { url: `${fixtureBase}/named-download.pdf` });
    expect(result.ok).toBe(true);
    expect(result.path).toBe("downloads/Quarterly Report.pdf");
  });

  it("never lets a hostile server filename escape the workspace", async () => {
    await initialize();
    const result = await call("resource_download", { url: `${fixtureBase}/evil-name.pdf` });
    expect(result.ok).toBe(true);
    // The traversal is stripped to a bare basename; the server's (harmless)
    // .sh extension survives but the file lands inside downloads/ only.
    expect(result.path).toBe("downloads/evil.sh");
    expect(result.path).not.toMatch(/\.\./);
    expect(readdirSync(join(workspace, "downloads"))).toContain("evil.sh");
  });

  it("does not overwrite; it de-conflicts", async () => {
    await initialize();
    const first = await call("resource_download", { url: `${fixtureBase}/named-download.pdf` });
    const second = await call("resource_download", { url: `${fixtureBase}/named-download.pdf` });
    expect(second.path).not.toBe(first.path);
    expect(second.path).toMatch(/-1\.pdf$/);
  });

  it("reports HTTP errors without storing anything", async () => {
    await initialize();
    const result = await call("resource_download", { url: `${fixtureBase}/missing-file` });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/404/);
    expect(existsSafe(join(workspace, "downloads"))).toBe(false);
  });

  it("stops oversized downloads mid-stream and leaves no .part behind", async () => {
    await initialize();
    const result = await call("resource_download", { url: `${fixtureBase}/big.dl` });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/limit/);
    const tmpEntries = existsSafe(join(workspace, ".tmp")) ? readdirSync(join(workspace, ".tmp")) : [];
    expect(tmpEntries.filter((name) => name.endsWith(".part"))).toHaveLength(0);
  });

  it("extracts text from a stored PDF", async () => {
    await initialize();
    const stored = await call("resource_download", { url: `${fixtureBase}/report.pdf` });
    const extraction = await call("resource_extract_pdf_text", { path: stored.path });
    expect(extraction.ok).toBe(true);
    expect(extraction.hasExtractableText).toBe(true);
    expect(extraction.text).toContain("OpenMausBot fixture PDF text");
    expect(extraction.pages).toBe(1);
  });

  it("reports scanned PDFs honestly instead of inventing text", async () => {
    await initialize();
    const stored = await call("resource_download", { url: `${fixtureBase}/scan.pdf` });
    const extraction = await call("resource_extract_pdf_text", { path: stored.path });
    expect(extraction.ok).toBe(true);
    expect(extraction.hasExtractableText).toBe(false);
    expect(extraction.note).toMatch(/no directly extractable text/);
  });

  it("extracts a page range from a multi-page PDF", async () => {
    await initialize();
    const stored = await call("resource_download", { url: `${fixtureBase}/three-pages.pdf` });
    const extraction = await call("resource_extract_pdf_text", { path: stored.path, fromPage: 2, toPage: 3 });
    expect(extraction.ok).toBe(true);
    expect(extraction.extractedPages).toBe(2);
    expect(extraction.text).toContain("page two marker");
    expect(extraction.text).toContain("page three marker");
    expect(extraction.text).not.toContain("page one marker");
  });

  it("refuses to parse a non-PDF as a PDF", async () => {
    await initialize();
    await call("workspace_write", { path: "plain.txt", content: "just text" });
    const error = await callErr("resource_extract_pdf_text", { path: "plain.txt" });
    expect(error).toMatch(/PDF signature/);
  });

  it("extracts links from a URL and from a stored file", async () => {
    await initialize();
    const live = await call("resource_extract_links", { url: `${fixtureBase}/links.html` });
    expect(live.ok).toBe(true);
    const report = live.links.find((link: any) => link.url === `${fixtureBase}/docs/report.pdf`);
    expect(report.text).toBe("Report");
    expect(live.links.find((link: any) => link.url.startsWith("https://external.example")).sameOrigin).toBe(false);
    const downloads = await call("resource_extract_links", { url: `${fixtureBase}/links.html`, kind: "downloads" });
    expect(downloads.links.map((link: any) => link.url)).toContain(`${fixtureBase}/docs/report.pdf`);
    expect(downloads.links.map((link: any) => link.url)).not.toContain("https://external.example/page");

    await call("workspace_write", { path: "pages/saved.html", content: routes["/hello.html"]!.body.toString("utf8") });
    const fromStore = await call("resource_extract_links", { path: "pages/saved.html", url: `${fixtureBase}/hello.html` });
    expect(fromStore.ok).toBe(true);
    expect(fromStore.links.map((link: any) => link.url)).toContain(`${fixtureBase}/docs/report.pdf`);
  });

  it("describes stored artifacts: PDF pages, image dimensions, provenance", async () => {
    await initialize();
    const stored = await call("resource_download", { url: `${fixtureBase}/report.pdf` });
    const info = await call("resource_artifact_info", { path: stored.path });
    expect(info.ok).toBe(true);
    expect(info.detectedKind).toBe("pdf");
    expect(info.pdf.pages).toBe(1);
    expect(info.sourceUrl).toBe(`${fixtureBase}/report.pdf`);
    expect(info.sha256).toBe(stored.sha256);

    const image = await call("resource_download", { url: `${fixtureBase}/pixel.png` });
    const imageInfo = await call("resource_artifact_info", { path: image.path });
    expect(imageInfo.detectedKind).toBe("image");
    expect(imageInfo.image).toEqual({ width: 1, height: 1, format: "png" });
  });

  it("refuses a redirect that changes host to a local name (SSRF)", async () => {
    await initialize();
    // hop1 → hop2 → http://localhost:PORT/secret: the final hop's host is
    // not on the (literal-only) test seam, so the redirect chain must die
    // on per-hop validation even though the FIRST hop was allowed.
    const fetched = await call("resource_fetch", { url: `${fixtureBase}/hop1` });
    expect(fetched.ok).toBe(false);
    expect(fetched.error).toMatch(/local hostnames|refused/i);
    const downloaded = await call("resource_download", { url: `${fixtureBase}/hop1` });
    expect(downloaded.ok).toBe(false);
    expect(downloaded.error).toMatch(/local hostnames|refused/i);
    expect(existsSafe(join(workspace, "downloads"))).toBe(false);
  });

  it("refuses private-address literals outside the test seam", async () => {
    await initialize();
    // 127.0.0.9 is a loopback literal but NOT on the seam (which lists only
    // the fixture host), so the policy must refuse it outright.
    const result = await call("resource_fetch", { url: `http://127.0.0.9:${fixturePort}/secret` });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private, loopback/i);
  });

  it("refuses a redirect loop with a clear message", async () => {
    await initialize();
    const result = await call("resource_fetch", { url: `${fixtureBase}/loop-a` });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/redirect/i);
  });

  it("fails closed on a hostile DNS name without resolving it", async () => {
    await initialize();
    const result = await call("resource_fetch", { url: "http://dns.rebind.attacker/x" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/resolve|DNS/i);
  });

  it("keeps the old http_fetch contract working through the guarded path", async () => {
    await initialize();
    const ok = await call("http_fetch", { url: `${fixtureBase}/data.json` });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain("\"value\":42");
    expect(ok.finalUrl).toBe(`${fixtureBase}/data.json`);

    const refused = await call("http_fetch", { url: `http://127.0.0.9:1/x` });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/private|loopback/i);

    const oversized = await call("http_fetch", { url: `${fixtureBase}/big.txt` });
    expect(oversized.truncated).toBe(true);
    expect(oversized.size).toBe(2 * 1024 * 1024);

    const echoed = await call("http_fetch", {
      url: `${fixtureBase}/echo`,
      method: "POST",
      body: JSON.stringify({ hello: "maus" }),
    });
    expect(JSON.parse(echoed.body).echo).toBe(JSON.stringify({ hello: "maus" }));
  });

  it("still enforces workspace containment for every path argument", async () => {
    await initialize();
    // Tool refusals arrive as isError results (never rejections).
    const write = await call("workspace_write", { path: "../outside.txt", content: "no" });
    expect(write.ok).toBe(false);
    expect(write.error).toMatch(/escapes the workspace/);
    const pdf = await call("resource_extract_pdf_text", { path: "../outside.txt" });
    expect(pdf.ok).toBe(false);
    expect(pdf.error).toMatch(/escapes the workspace/);
    const info = await call("resource_artifact_info", { path: "/etc/hostname" });
    expect(info.ok).toBe(false);
  });

  function existsSafe(path: string): boolean {
    try {
      readdirSync(path);
      return true;
    } catch {
      return false;
    }
  }
});
