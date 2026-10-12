#!/usr/bin/env node
// Bundle smoke test: the phone runs the BUNDLED adapter, while the vitest
// integration suite runs the TypeScript source. This script proves the
// bundle boots, lists the resource tools, downloads a PDF over real HTTP
// (loopback seam on, exactly as a test would), and extracts its text with
// the inlined pdf.js. Exit 0 = bundle usable.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
  "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n" +
  "4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 18 Tf 72 720 Td (bundle smoke ok) Tj ET\nendstream\nendobj\n" +
  "trailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF\n",
  "latin1",
);

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/pdf" });
  res.end(PDF);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const workspace = mkdtempSync(join(tmpdir(), "omb-bundle-smoke-"));
const child = spawn(process.execPath, [join("dist-server", "android-computer.js")], {
  env: {
    ...process.env,
    AC_WORKSPACE: workspace,
    OMB_NETGUARD_ALLOW_LOOPBACK: "1",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.on("data", (c) => process.stderr.write(`[bundle] ${c}`));

let buffer = "";
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
    const msg = JSON.parse(line);
    const entry = pending.get(msg.id);
    if (entry) { pending.delete(msg.id); entry(msg); }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout on ${method}`)), 30_000);
    pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const call = async (tool, args) => {
  const response = await rpc("tools/call", { name: tool, arguments: args });
  return JSON.parse(response.result.content[0].text);
};

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

try {
  const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
  check("bundle initializes", init.result?.serverInfo?.name === "android_computer");
  const { result: list } = await rpc("tools/list");
  const names = list.tools.map((t) => t.name);
  check("resource tools present in bundle", ["resource_fetch", "resource_download", "resource_extract_pdf_text"].every((n) => names.includes(n)));

  const dl = await call("resource_download", { url: `http://127.0.0.1:${port}/smoke.pdf` });
  check("bundle download works", dl.ok === true && /^downloads\/.+\.pdf$/.test(dl.path ?? ""), dl.error ?? dl.path);
  const pdf = await call("resource_extract_pdf_text", { path: dl.path });
  check("bundled pdf.js extracts text", pdf.ok === true && pdf.text?.includes("bundle smoke ok"), pdf.error ?? pdf.text?.slice(0, 60));
} catch (error) {
  check("smoke run", false, error.message);
} finally {
  child.kill("SIGKILL");
  server.close();
  rmSync(workspace, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
