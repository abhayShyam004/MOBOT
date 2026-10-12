// On-device probe for the internet resource tools (runs ON THE PHONE).
//
// Spawned by test-android-resources.mjs via `run-as` with the app's own
// embedded node. It starts the on-device fixture HTTP server, spawns the
// BUNDLED android-computer adapter exactly as the harness does (stdio MCP),
// and drives the resource tools deterministically:
//
//   happy path    — inspect/fetch/download/extract over real loopback HTTP
//   pdf           — bundled pdf.js text extraction + scanned-PDF honesty
//   images        — magic-byte detection + real dimensions from headers
//   filenames     — Content-Disposition honored; hostile name sanitized
//   ssrf          — private literal, local hostname, redirect-to-local refused
//   parity        — http_fetch still answers (guarded path)
//   cancellation  — SIGTERM mid-download leaves no completed artifact
//
// The loopback seam is scoped to THIS probe process via env; the adapter the
// harness spawns for real turns never has it. Output: progress lines on
// stderr, one final line `RESULTJSON:[...]` on stdout with every check.
"use strict";
const http = require("node:http");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ADAPTER = process.argv[2] ?? "";
const WORKSPACE = process.argv[3] ?? "";
const FIXTURE_PORT = Number(process.argv[4] ?? 28791);
if (!ADAPTER || !WORKSPACE) {
  process.stderr.write("usage: omb-resprobe.cjs <adapter.js> <workspace> [fixturePort]\n");
  process.exit(2);
}

// ── fixtures ────────────────────────────────────────────────────────────────
function buildMinimalPdf(text) {
  const parts = [];
  let offset = 0;
  const push = (s) => { const b = Buffer.from(s, "latin1"); parts.push(b); offset += b.length; };
  push("%PDF-1.4\n");
  const offsets = [];
  const addObj = (body) => { offsets.push(offset); push(body); };
  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  const stream = text === null ? "" : `BT /F1 18 Tf 72 720 Td (${text.replace(/([()\\])/g, "\\$1")}) Tj ET`;
  addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n");
  addObj(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  addObj("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  const xrefStart = offset;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (const off of offsets) push(`${String(off).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.concat(parts);
}

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const INDEX_HTML = `<!doctype html>
<html><head><title>Probe Fixture</title></head><body>
<p>On-device fixture body.</p>
<a href="/docs/report.pdf">Report</a>
<a href="https://external.example/page">External</a>
<img src="/img/hero.png" alt="Hero">
</body></html>`;

const MARKER = "omb-on-device-marker-2847";
const PDF_TEXT = buildMinimalPdf(MARKER);
const PDF_SCAN = buildMinimalPdf(null);

let fixtureServer = null;
function startFixture() {
  return new Promise((resolve) => {
    fixtureServer = http.createServer((req, res) => {
      const p = (req.url ?? "/").split("?")[0];
      if (p === "/endless") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        const timer = setInterval(() => res.write(Buffer.alloc(64 * 1024, 0x42)), 50);
        req.on("close", () => clearInterval(timer));
        return;
      }
      if (p === "/hop") {
        res.writeHead(302, { location: `http://localhost:${FIXTURE_PORT}/secret` });
        res.end();
        return;
      }
      if (p === "/secret") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("never visible");
        return;
      }
      if (p === "/" || p === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(INDEX_HTML);
        return;
      }
      if (p === "/data.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ fixture: true, value: 7 }));
        return;
      }
      if (p === "/report.pdf") {
        res.writeHead(200, { "content-type": "text/html" }); // the classic lie
        res.end(PDF_TEXT);
        return;
      }
      if (p === "/scan.pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end(PDF_SCAN);
        return;
      }
      if (p === "/pixel.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PNG_1X1);
        return;
      }
      if (p === "/named.pdf") {
        res.writeHead(200, {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="Probe Report.pdf"',
        });
        res.end(PDF_TEXT);
        return;
      }
      if (p === "/evil.pdf") {
        res.writeHead(200, {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="../../evil.sh"',
        });
        res.end(PDF_TEXT);
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("no such fixture");
    });
    fixtureServer.listen(FIXTURE_PORT, "127.0.0.1", resolve);
  });
}

// ── MCP client over stdio ───────────────────────────────────────────────────
function spawnAdapter(extraEnv = {}) {
  const child = spawn(process.execPath, [ADAPTER], {
    env: { ...process.env, AC_WORKSPACE: WORKSPACE, OMB_NETGUARD_ALLOW_LOOPBACK: "1", ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", (c) => process.stderr.write(`[adapter] ${c}`));
  let buffer = "";
  // A killed adapter never answers pending rpcs; reject them immediately so
  // the cancellation leg does not wait out the rpc timeout.
  child.on("exit", () => {
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry(new Error(`adapter exited before replying (id ${id})`));
    }
  });
  let nextId = 1;
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const entry = pending.get(msg.id);
      if (entry) { pending.delete(msg.id); entry(msg); }
    }
  });
  return {
    child,
    rpc(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { pending.delete(id); reject(new Error(`probe timeout on ${method}`)); }, 45_000);
        pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    },
    async init() {
      await this.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "0" } });
    },
    async call(tool, args) {
      const response = await this.rpc("tools/call", { name: tool, arguments: args });
      const text = response?.result?.content?.[0]?.text ?? "{}";
      return { isError: response?.result?.isError === true, payload: JSON.parse(text) };
    },
  };
}

const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };
const downloadsDir = () => path.join(WORKSPACE, "downloads");
const downloadedFiles = () => { try { return fs.readdirSync(downloadsDir()); } catch { return []; } };

// ── the checks ──────────────────────────────────────────────────────────────
async function run() {
  const results = [];
  const t = (name, ok, detail = "") => {
    results.push({ name, ok: !!ok, detail: String(detail).slice(0, 240) });
    process.stderr.write(`probe: ${ok ? "pass" : "FAIL"} ${name}${detail ? ` — ${String(detail).slice(0, 120)}` : ""}\n`);
  };
  const BASE = `http://127.0.0.1:${FIXTURE_PORT}`;

  await startFixture();
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });

  const adapter = spawnAdapter();
  try {
    await adapter.init();
    const { result: list } = await adapter.rpc("tools/list");
    const names = list.tools.map((tool) => tool.name);
    t("resource tools mounted by the bundled adapter",
      ["resource_inspect", "resource_fetch", "resource_download", "resource_extract_pdf_text", "resource_extract_links", "resource_artifact_info", "resource_list"].every((n) => names.includes(n)),
      names.join(",").slice(0, 200));

    // inspect
    const inspect = await adapter.call("resource_inspect", { url: `${BASE}/report.pdf` });
    t("inspect: status/type/filename without a body",
      inspect.payload.ok === true && inspect.payload.status === 200 && inspect.payload.contentType === "text/html" && inspect.payload.suggestedFilename === "report.pdf",
      JSON.stringify(inspect.payload).slice(0, 200));

    // fetch html
    const page = await adapter.call("resource_fetch", { url: `${BASE}/index.html` });
    t("fetch html: title, bounded text, absolute links, images",
      page.payload.ok === true && page.payload.title === "Probe Fixture" &&
      page.payload.text?.includes("On-device fixture body.") &&
      page.payload.links?.some((l) => l.url === `${BASE}/docs/report.pdf` && l.looksDownloadable === true) &&
      page.payload.images?.some((i) => i.url === `${BASE}/img/hero.png`),
      JSON.stringify({ links: page.payload.links?.length, images: page.payload.images?.length }));

    // fetch json
    const json = await adapter.call("resource_fetch", { url: `${BASE}/data.json` });
    t("fetch json detected and readable",
      json.payload.ok === true && json.payload.detectedKind === "json" && String(json.payload.text ?? "").includes('"value":7'),
      json.payload.detectedKind);

    // download the mislabeled pdf
    const dl = await adapter.call("resource_download", { url: `${BASE}/report.pdf` });
    const stored = dl.payload.path ? path.join(WORKSPACE, dl.payload.path) : "";
    const storedBytes = stored && exists(stored) ? fs.readFileSync(stored) : null;
    const expectedHash = crypto.createHash("sha256").update(PDF_TEXT).digest("hex");
    t("download: mislabeled PDF sniffed by magic bytes, bytes identical, sha256 correct",
      dl.payload.ok === true && dl.payload.detectedKind === "pdf" && dl.payload.detectedContentType === "application/pdf" &&
      storedBytes?.equals(PDF_TEXT) === true && dl.payload.sha256 === expectedHash,
      JSON.stringify({ path: dl.payload.path, kind: dl.payload.detectedKind, error: dl.payload.error }));

    // pdf extraction (bundled pdf.js)
    const extract = await adapter.call("resource_extract_pdf_text", { path: dl.payload.path });
    t("pdf text extracted by the bundled pdf.js on-device",
      extract.payload.ok === true && extract.payload.hasExtractableText === true && String(extract.payload.text ?? "").includes(MARKER),
      JSON.stringify({ chars: extract.payload.extractedChars, error: extract.payload.error }));

    // scanned pdf honesty
    const scan = await adapter.call("resource_download", { url: `${BASE}/scan.pdf` });
    const scanExtract = await adapter.call("resource_extract_pdf_text", { path: scan.payload.path });
    t("scanned PDF reported image-only, no invented text",
      scanExtract.payload.ok === true && scanExtract.payload.hasExtractableText === false && /no directly extractable text/.test(String(scanExtract.payload.note ?? "")),
      scanExtract.payload.note?.slice(0, 120) ?? JSON.stringify(scanExtract.payload).slice(0, 120));

    // image download with dimensions
    const image = await adapter.call("resource_download", { url: `${BASE}/pixel.png` });
    t("image download: detected, dimensions from the header",
      image.payload.ok === true && image.payload.detectedKind === "image" &&
      image.payload.image?.width === 1 && image.payload.image?.height === 1,
      JSON.stringify(image.payload.image ?? image.payload.error));

    // disposition filename
    const named = await adapter.call("resource_download", { url: `${BASE}/named.pdf` });
    t("Content-Disposition filename honored (sanitized)",
      named.payload.ok === true && named.payload.path === "downloads/Probe Report.pdf", named.payload.path ?? named.payload.error);

    // hostile filename
    const evil = await adapter.call("resource_download", { url: `${BASE}/evil.pdf` });
    const evilEscaped = evil.payload.path ? !path.join(WORKSPACE, evil.payload.path).startsWith(downloadsDir()) : true;
    t("hostile server filename cannot escape the workspace",
      evil.payload.ok === true && evil.payload.path === "downloads/evil.sh" && !evilEscaped, evil.payload.path ?? evil.payload.error);

    // no-overwrite
    const again = await adapter.call("resource_download", { url: `${BASE}/named.pdf` });
    t("downloads never overwrite (de-conflicted names)",
      again.payload.ok === true && again.payload.path !== named.payload.path && String(again.payload.path).endsWith("-1.pdf"),
      again.payload.path);

    // artifact manifest
    const manifest = await adapter.call("resource_list");
    t("artifact manifest records source url + checksum",
      manifest.payload.ok === true && manifest.payload.artifacts?.some((a) => a.url === `${BASE}/report.pdf` && a.contentKind === "pdf"),
      `count=${manifest.payload.count}`);

    // artifact info
    const info = await adapter.call("resource_artifact_info", { path: dl.payload.path });
    t("artifact info: detected kind + provenance",
      info.payload.ok === true && info.payload.detectedKind === "pdf" && info.payload.sourceUrl === `${BASE}/report.pdf` && typeof info.payload.pdf?.pages === "number",
      JSON.stringify(info.payload).slice(0, 200));

    // ssrf: direct private literal (not on the seam: 127.0.0.9)
    const ssrf1 = await adapter.call("resource_fetch", { url: `http://127.0.0.9:${FIXTURE_PORT}/secret` });
    t("SSRF: private loopback literal refused",
      ssrf1.payload.ok === false && /private|loopback/i.test(String(ssrf1.payload.error ?? "")), ssrf1.payload.error);
    // ssrf: local hostname by name
    const ssrf2 = await adapter.call("resource_fetch", { url: `http://localhost:${FIXTURE_PORT}/secret` });
    t("SSRF: local hostname refused",
      ssrf2.payload.ok === false && /local hostnames|refused/i.test(String(ssrf2.payload.error ?? "")), ssrf2.payload.error);
    // ssrf: redirect into a local hostname
    const ssrf3 = await adapter.call("resource_fetch", { url: `${BASE}/hop` });
    t("SSRF: redirect into a local hostname refused",
      ssrf3.payload.ok === false && /local hostnames|refused|redirect/i.test(String(ssrf3.payload.error ?? "")), ssrf3.payload.error);
    const noSecret = !downloadedFiles().some((f) => f === "secret") && !exists(path.join(WORKSPACE, "downloads", "secret"));
    t("SSRF: the protected resource never landed in the workspace", noSecret);

    // http_fetch parity through the guarded path
    const parity = await adapter.call("http_fetch", { url: `${BASE}/data.json` });
    const parityBlocked = await adapter.call("http_fetch", { url: `http://127.0.0.9:1/x` });
    t("http_fetch parity: works for public(ish) targets, still refuses private literals",
      parity.payload.status === 200 && String(parity.payload.body ?? "").includes('"value":7') &&
      parityBlocked.payload.ok === false,
      `status=${parity.payload.status} blocked=${parityBlocked.payload.ok === false}`);

    // offline behavior: a dead port fails clearly (no fake success)
    const offline = await adapter.call("resource_fetch", { url: "http://127.0.0.1:9/x" });
    t("connection refused answers as a failure, not a fake success",
      offline.payload.ok === false && /refused|failed|ECONNREFUSED/i.test(String(offline.payload.error ?? "")), offline.payload.error);

    // cancellation: start an endless download, SIGTERM the adapter mid-stream
    const endless = spawnAdapter();
    await endless.init();
    const dlPromise = endless.call("resource_download", { url: `${BASE}/endless` }).catch((error) => ({ payload: { ok: false, error: `probe: ${error.message}` } }));
    let sawPart = false;
    for (let i = 0; i < 100; i += 1) {
      try {
        if (fs.readdirSync(path.join(WORKSPACE, ".tmp")).some((f) => f.endsWith(".part"))) { sawPart = true; break; }
      } catch { /* tmp dir not created yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    endless.child.kill("SIGTERM");
    const dlOutcome = await dlPromise;
    const noCompletedArtifact = !downloadedFiles().some((f) => /endless|\.bin/i.test(f));
    t("cancellation: SIGTERM mid-download, .part appeared, NO completed artifact",
      sawPart && dlOutcome.payload.ok !== true && noCompletedArtifact,
      `sawPart=${sawPart} ok=${dlOutcome.payload.ok} downloads=${downloadedFiles().join(",")}`);
    endless.child.kill("SIGKILL");

    // ── hardening-phase regressions (quiet-chat device phase) ──────────────
    // workspace_stat on a missing path must answer a STRUCTURED error, never
    // the raw `android_computer_workspace_stat` tool crash that used to land
    // in chat as a row.
    const ghost = await adapter.call("workspace_stat", { path: "nope/ghost.txt" });
    t("workspace_stat missing path: structured error, not a raw tool crash",
      ghost.payload.ok === false && typeof ghost.payload.error === "string" && ghost.payload.error.includes("ghost.txt") && ghost.payload.error.includes("workspace"),
      JSON.stringify(ghost.payload).slice(0, 140));
    const ghostRead = await adapter.call("workspace_read", { path: "nope/ghost.txt" });
    t("workspace_read missing path: structured error (same policy)",
      ghostRead.payload.ok === false && typeof ghostRead.payload.error === "string",
      JSON.stringify(ghostRead.payload).slice(0, 120));

    // symlink escape: a link pointing outside the workspace must be refused
    // by the sandbox's canonical containment, on-device too.
    const os = require("node:os");
    const outside = path.join(os.tmpdir(), `omb-probe-escape-${Date.now()}.txt`);
    fs.writeFileSync(outside, "secret");
    fs.mkdirSync(path.join(WORKSPACE, "links"), { recursive: true });
    fs.symlinkSync(outside, path.join(WORKSPACE, "links", "escape"));
    try {
      const viaLink = await adapter.call("workspace_read", { path: "links/escape" });
      t("symlink pointing outside the workspace is refused (canonical containment)",
        viaLink.payload.ok === false && /escape|symlink|resolved/i.test(String(viaLink.payload.error ?? "")),
        JSON.stringify(viaLink.payload).slice(0, 140));
    } finally {
      try { fs.rmSync(path.join(WORKSPACE, "links"), { recursive: true, force: true }); } catch { }
      try { fs.rmSync(outside, { force: true }); } catch { }
    }

    // absolute path spelling inside the workspace is fine (not an escape);
    // outside it must be refused.
    const absIn = await adapter.call("workspace_write", { path: "/abs.txt", content: "workspace-absolute ok" });
    t("workspace-absolute path spelling writes inside the sandbox",
      absIn.payload.ok === true, JSON.stringify(absIn.payload).slice(0, 100));
    const absOut = await adapter.call("workspace_stat", { path: "/etc/hostname" });
    t("absolute path outside the sandbox refused",
      absOut.payload.ok === false, JSON.stringify(absOut.payload).slice(0, 120));
  } finally {
    try { adapter.child.kill("SIGKILL"); } catch { /* already gone */ }
    fixtureServer?.close();
  }

  process.stdout.write(`RESULTJSON:${JSON.stringify(results)}\n`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

run().catch((error) => {
  process.stderr.write(`probe crashed: ${error?.stack ?? error}\n`);
  process.stdout.write(`RESULTJSON:${JSON.stringify([{ name: "probe completed without crashing", ok: false, detail: String(error?.message ?? error).slice(0, 200) }])}\n`);
  process.exit(1);
});
